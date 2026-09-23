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

## Gap for the next ticket (#25)

Nothing runs on the VM yet beyond the base OS + Node.js. #25 still needs: cloning/deploying Tripkit itself, a systemd unit so it survives reboots and SSH disconnects, and a reverse proxy (e.g. Caddy) terminating TLS on 80/443 and forwarding to Tripkit's own port.
