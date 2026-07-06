# DEPLOYMENT.md — deploying MACL

MACL is **deployed to a persistent cloud server** on Oracle Cloud's "Always Free" tier — the whole
system (3-node Besu chain, REST API, and dashboard) runs on one small VM, reachable at a fixed public
address. That live deployment, and how it was built, is **Section 1** below.

A lightweight **Cloudflare tunnel** option — which exposes the system running on a local machine at a
temporary public address, with no cloud account needed — is documented in **Section 2** as an
alternative.

**How the hosted setup fits together:** one VM runs everything. A small web server, **Caddy**, sits
in front on port 80: it serves the dashboard files and forwards anything under `/api` to the Node
API. Because the dashboard and API share one address, the dashboard's automatic API selection (in
`dashboard/config.js`) "just works" with no editing.

```
Browser ──HTTP──▶  Caddy (port 80)  ┬─ "/"      → dashboard files
                                     └─ "/api/*" → Node API (127.0.0.1:3001) → 3 Besu nodes
```

> The live demo is served over HTTP at the VM's IP address. Because the system uses only synthetic
> data (no personal data or real funds), HTTPS is not required for the demo; adding a domain + HTTPS
> is documented as an optional upgrade at the end of Section 1.

---

# Section 1 — Live deployment on Oracle Cloud "Always Free"

**What you need:** a card enabled for international online payments (identity verification only — no
charge on Always Free), and about 1–2 hours the first time.

## Part 0 — Create a free Oracle Cloud account

1. Go to **<https://www.oracle.com/cloud/free/>** → **Start for free**.
2. Enter your email, verify it, and set your details with **Rwanda** as the country.
3. **Home Region (permanent):** choose one close to Rwanda — **South Africa Central (Johannesburg)**.
4. Verify with a card (a temporary $0 authorization; no charge on Always Free), and finish. Wait a
   few minutes for the account to provision, then sign in to the **Oracle Cloud Console**.

> **Free-tier note:** the account includes a 30-day trial *and* the permanently-free "Always Free"
> resources. As long as you build only on **Always-Free-eligible** resources and never click
> "Upgrade to Pay As You Go", the card is never charged and the deployment keeps running after the
> trial ends.

> **Capacity note:** the free Arm shape is in high demand and often returns "Out of host capacity."
> Retry the create button at a calm pace (roughly once a minute — rapid clicking triggers a rate
> limit), and it eventually goes through.

## Part 1 — Create the VM

1. **☰ menu → Compute → Instances → Create instance.**
2. **Name:** `macl-server`.
3. **Image and shape:**
   - **Image:** Canonical **Ubuntu 22.04**.
   - **Shape:** **Ampere → VM.Standard.A1.Flex** (the **Always Free-eligible** Arm shape). 1 OCPU /
     6 GB is fine (we add swap later to give the three Besu nodes headroom).
4. **Security section:** leave **both** toggles OFF (no Shielded instance, no Confidential computing).
5. **Networking:** create a new VCN + **public subnet**, and enable **Assign a public IPv4 address**
   if the toggle is available. (If the toggle is greyed out — a known wizard quirk — skip it and
   assign the IP in Part 2.)
6. **Add SSH keys:** first make a key on your Mac —

   ```
   ssh-keygen -t ed25519 -C "macl" -f ~/.ssh/macl_key
   ```

   Press Enter through the prompts, then `cat ~/.ssh/macl_key.pub` and paste that line into
   **"Paste public keys."**
7. **Storage:** leave the boot volume default (~46.6 GB, free). **Create**, and wait for **Running**.

## Part 2 — Assign a public IP (if it's blank)

If the instance's **Public IPv4 address** shows "—":

1. Instance → **Networking** tab → click the **VNIC** → **IP administration**.
2. On the private-IP row, **⋮ → Edit** → set **Public IP → Ephemeral public IP** → **Update**.
3. Copy the assigned public IP (the live server used **145.241.184.66**).

## Part 3 — Open the firewall for web traffic

**A. Oracle security list:** instance → Networking → the **subnet** → **Security Lists** → **Default
Security List** → **Add Ingress Rules** → Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port
**80**. (Add **443** too if you plan to enable HTTPS later.)

**B. Ubuntu's own firewall** (do this after you SSH in, Part 4):

```
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save
```

## Part 4 — Connect over SSH

```
ssh -i ~/.ssh/macl_key ubuntu@YOUR_PUBLIC_IP
```

Type `yes` the first time. The prompt changes to `ubuntu@macl-server`. Everything below runs **on the
server**.

## Part 5 — Install Docker, Node, git, and add swap

```
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
# 4 GB swap so three Besu (JVM) nodes fit comfortably in 6 GB RAM
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
docker --version && node --version
```

## Part 6 — Get the code

```
cd ~
git clone https://github.com/Aimee-Gloire/MACL-System.git macl
cd macl
```

## Part 7 — Start the chain and deploy the contracts

```
cd ~/macl/blockchain
sudo bash setup-network.sh
sudo docker compose up -d
sleep 25 && sudo docker compose ps          # three nodes should show "Up"

cd ~/macl/contracts
cp .env.example .env
npm install
npm run deploy:besu                          # deploys the 3 contracts + registers the orgs
```

On a fresh chain the printed contract addresses match the defaults already in `api/.env.example`, so
no address editing is needed.

## Part 8 — Configure and start the API (pm2)

```
cd ~/macl/api
cp .env.example .env
npm install
# set a JWT secret, bcrypt-hash the login passwords, and pin CORS to the server
cat > setup-env.js <<'EOF'
const fs=require('fs'),crypto=require('crypto'),bcrypt=require('bcrypt');
let env=fs.readFileSync('.env','utf8');
const set=(k,v)=>{const re=new RegExp('^'+k+'=.*$','m');env=re.test(env)?env.replace(re,k+'='+v):env+'\n'+k+'='+v;};
set('JWT_SECRET',crypto.randomBytes(32).toString('hex'));
const pw='macl1234';
for(const r of ['DONOR','NGO','AUDIT','ADMIN'])set(r+'_PW_HASH',bcrypt.hashSync(pw,10));
set('CORS_ORIGIN','http://YOUR_PUBLIC_IP');
fs.writeFileSync('.env',env);
console.log('ENV OK. Login password for all roles = '+pw);
EOF
node setup-env.js
sudo npm install -g pm2
pm2 start server.js --name macl-api
pm2 save
curl -s http://127.0.0.1:3001/api/health; echo    # expect {"ok":true, ...}
```

> `DATABASE_URL` is left unset, so the optional document store is disabled (upload/verify endpoints
> return 503) and every other flow works. To enable file evidence, set `DATABASE_URL` to a Neon/
> Postgres connection string and run `npm run migrate`.

## Part 9 — Put Caddy in front (serve dashboard + proxy /api on port 80)

```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
:80 {
 handle /api/* {
  reverse_proxy 127.0.0.1:3001
 }
 handle {
  root * /home/ubuntu/macl/dashboard
  file_server
 }
}
EOF
# let the caddy user read into the home folder, then start it
sudo chmod o+x /home/ubuntu
sudo systemctl restart caddy
```

## Part 10 — Verify it's live

Open **http://YOUR_PUBLIC_IP/** in a browser (the live server is **<http://145.241.184.66/>**). You get
the sign-in page; log in as **donor / ngo / audit**, password **`macl1234`**, and the connection light
goes green. Try it on a phone over mobile data to confirm it's genuinely public.

**Screenshot the live URL + green connection light** — that's the "deployed and verified in the target
environment" evidence the rubric asks for.

## Optional upgrade — a domain + HTTPS

Point a domain (or a free **DuckDNS** subdomain) at the VM's IP, open port 443 (Part 3), then replace
the Caddyfile's `:80` line with your domain name — Caddy fetches a free HTTPS certificate
automatically:

```
your.domain {
    handle /api/* { reverse_proxy 127.0.0.1:3001 }
    handle { root * /home/ubuntu/macl/dashboard; file_server }
}
```

Reload with `sudo systemctl reload caddy`, and set `CORS_ORIGIN=https://your.domain` in `api/.env` +
`pm2 restart macl-api`.

## Keeping it running / making changes

- **Dashboard or API change:** on the VM, `cd ~/macl && git pull`, then `pm2 restart macl-api` (API)
  or just hard-refresh the browser (dashboard). Seconds; no data lost.
- **Contract change:** redeploy (`npm run deploy:besu`) — this starts a **fresh, empty** ledger at new
  addresses, so decide contract logic before relying on live data. Update the `*_ADDRESS` values in
  `api/.env` and `pm2 restart macl-api`.
- The chain data lives in `~/macl/blockchain/Node-*/data`. **Never** run `docker compose down -v`
  (the `-v` wipes it). A plain reboot is fine — Docker and pm2 restart automatically.

---

# Section 2 — Alternative: a quick public link via a Cloudflare tunnel

Use this to expose the system running on a **local machine** at a public HTTPS address with **no
cloud account and no card**. The link is live only while the machine, Caddy, and the tunnel are all
running — ideal for a fast demo without a server.

**One-time install** (Homebrew): `brew install caddy cloudflared`

1. **Run the stack locally** — the 3 Besu nodes (`docker compose up` in `blockchain/`) and the API
   (`npm start` in `api/`, port 3001).
2. **Start a local Caddy** that serves the dashboard and forwards `/api` on one port (8082):

   ```
   :8082 {
       handle /api/* { reverse_proxy 127.0.0.1:3001 }
       handle { root * /absolute/path/to/dashboard; file_server }
   }
   ```

   `caddy run --config /path/to/local-proxy.Caddyfile`
3. **Open the tunnel:** `cloudflared tunnel --url http://localhost:8082` — it prints a public
   `https://<random>.trycloudflare.com` URL that reaches the local system through Cloudflare's edge.

The tunnel URL changes each time `cloudflared` restarts.

---

# Troubleshooting

- **Site won't load externally:** ports not open — recheck both the Oracle **security list** ingress
  rule (port 80) *and* the Ubuntu `iptables` rule (Part 3).
- **Dashboard returns 403 (locally 200):** the `caddy` user can't read into the home folder — run
  `sudo chmod o+x /home/ubuntu` and `sudo systemctl restart caddy`.
- **API won't start / "JWT_SECRET missing":** the env wasn't written — re-run `node setup-env.js`
  from **inside** `~/macl/api` (so it finds `bcrypt`), then `pm2 restart macl-api`.
- **"Out of host capacity" on create:** retry at a calm pace (≈ once a minute); rapid clicks trigger a
  rate limit.
- **"no such contract" errors:** the chain was reset without redeploying — run `npm run deploy:besu`
  again and `pm2 restart macl-api`.
