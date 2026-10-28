# Cloudflare named-tunnel setup (one-time)

For a stable URL on your own domain (`https://drive.yourdomain.com`), optionally protected by a Cloudflare Access policy (email/password/SSO). Replaces the random `*.trycloudflare.com` URL of the quick-tunnel mode.

## Prerequisites

- A domain in your Cloudflare account
- `cloudflared` installed and logged in: `cloudflared tunnel login`
- (Optional but recommended) Cloudflare Zero Trust enabled and an Access policy you want to apply (e.g. a "password" policy)

## Steps

### 1. Create the tunnel

```sh
cloudflared tunnel create drivenvibe
```

Note the tunnel UUID printed.

### 2. Route DNS

If your domain is the same one your `cert.pem` covers:

```sh
cloudflared tunnel route dns drivenvibe drive.yourdomain.com
```

If `cloudflared` routes the DNS to the wrong zone (e.g. appends `.othersite.com`), add the CNAME manually in the Cloudflare dashboard for the correct zone:

- **Type:** `CNAME`
- **Name:** `drive`
- **Target:** `<TUNNEL_UUID>.cfargotunnel.com`
- **Proxy status:** Proxied (orange cloud)

### 3. Write the tunnel config

Create `~/.cloudflared/drivenvibe.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /path/to/your/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: drive.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

### 4. (Optional) Cloudflare Access — gate the URL

Cloudflare Zero Trust → Access → Applications → Add an Application → Self-hosted:

- **Application name:** `drivenvibe`
- **Session duration:** 24 hours
- **Application domain:** `drive.yourdomain.com`
- **Policies:** select an existing policy or create one (e.g. "allow my email")

Save. The first time you open the URL on a new device, you'll get a login page; after that the policy session lets you skip auth.

### 5. Run

```sh
TUNNEL=named TUNNEL_NAME=drivenvibe npm start
# or just:
./start-tunnel.bat   # Windows; defaults to drivenvibe
```

The server prints the tunnel URL in the startup box.
