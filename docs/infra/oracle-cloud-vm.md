# Oracle Cloud Always Free VM

Provisioned for [#26](https://github.com/kovartravis/tripkit/issues/26), to be used by [#25](https://github.com/kovartravis/tripkit/issues/25) (deploying Tripkit itself).

## What exists

- **Region**: `us-chicago-1`
- **Compute instance**: `tripkit-vm`, shape `VM.Standard.A1.Flex` (4 OCPU / 24 GB — the full Always Free Ampere A1 allowance), image `Canonical-Ubuntu-24.04-aarch64`
- **Networking**: dedicated VCN `tripkit-vcn` (`10.0.0.0/16`) → subnet `tripkit-subnet` (`10.0.1.0/24`) → internet gateway `tripkit-igw`, routed via route table `tripkit-rt`
- **Security list** `tripkit-seclist`: inbound TCP 22 (SSH), 80, 443, 4700 (Tripkit's default HTTP port, see `DEFAULT_HTTP_PORT` in `src/cli/index.ts`) from `0.0.0.0/0`; all egress open
- **OS-level firewall**: the same four ports are also opened in `iptables` via cloud-init (Oracle's stock Ubuntu images ship with restrictive `iptables` rules independent of the OCI security list — both layers had to be opened)
- **Node.js**: v22 installed via NodeSource, confirmed on first boot
- **SSH**: dedicated ed25519 keypair at `~/.ssh/tripkit_oci` (private, not in this repo) / `~/.ssh/tripkit_oci.pub`; connect as `ubuntu@<public-ip>`

## Managing it going forward

The OCI CLI is installed in a dedicated venv (`~/.oci-cli-venv`) and symlinked as `oci` on `PATH` via `~/.local/bin/oci`. It authenticates using the API signing key at `~/.oci/tripkit_api_key.pem` (already configured in `~/.oci/config` before this ticket).

Useful lookups (all scoped to the tenancy root compartment — no sub-compartments exist):

```sh
# Current public IP
oci compute instance list-vnics --instance-id <instance-id> --output json

# Instance state
oci compute instance get --instance-id <instance-id> --query 'data."lifecycle-state"'
```

Instance, VCN, and related OCIDs are not recorded here (they're not secret, but they're also not needed by anyone reading this file — look them up live via `oci compute instance list` / `oci network vcn list` by display name, all prefixed `tripkit-`).

## Deployment (#25)

Tripkit itself now runs on the VM, reachable at **https://147-224-167-3.sslip.io**:

- **App**: cloned at `/opt/tripkit/app`, owned by a dedicated unprivileged
  `tripkit` system user (home dir `/opt/tripkit`). Deployed by `git pull`
  + `npm ci` + `npm run build` as that user; there's no CD pipeline yet,
  redeploys are manual.
- **Process manager**: `deploy/tripkit.service` (checked into this repo),
  installed at `/etc/systemd/system/tripkit.service`. Runs
  `node dist/cli/index.js mcp --http --port 4700 --host 127.0.0.1 --public-url https://147-224-167-3.sslip.io`,
  `Restart=on-failure`, enabled so it survives reboots. Secrets come from
  `/etc/tripkit.env` (root:root, mode 600 — not in this repo), which sets
  `TRIPKIT_SUPABASE_URL`, `TRIPKIT_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_HOST/PORT/USER/NAME/PASSWORD`
  for the production Supabase project.
- **TLS / reverse proxy**: Caddy (installed via the official apt repo),
  config at `/etc/caddy/Caddyfile` (mirrors `deploy/Caddyfile` in this
  repo), terminates TLS on 80/443 and forwards to `127.0.0.1:4700`. Cert is
  a real Let's Encrypt cert for the `147-224-167-3.sslip.io` hostname —
  [sslip.io](https://sslip.io) is a free wildcard-DNS service that resolves
  `<ip-with-dashes>.sslip.io` straight to that IP, used here instead of a
  purchased domain. Caddy renews automatically.
- **Port 4700**: Tripkit itself only binds to loopback now; the security
  list / `iptables` rule that opened 4700 externally (see above) is
  harmless but no longer load-bearing — all public traffic comes in over
  443 via Caddy.

**Caveat**: the public URL is tied to the VM's current IP
(`147.224.167.3`). If the instance is ever recreated (new IP), the
`--public-url` in `tripkit.service` and the hostname in the Caddyfile both
need updating to match, and clients will need to reconnect at the new URL.
A real domain (an A record pointed at whatever IP the VM has) would remove
this coupling — swap to one later by editing those two files and re-issuing
the Caddy cert.

Redeploying a new build:

```sh
ssh -i ~/.ssh/tripkit_oci ubuntu@147.224.167.3
sudo -u tripkit bash -c 'cd /opt/tripkit/app && git pull && npm ci && npm run build'
sudo systemctl restart tripkit
```
