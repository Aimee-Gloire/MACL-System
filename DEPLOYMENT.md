# DEPLOYMENT.md — hosting MACL on a free cloud server

This is the full, plain-language guide to putting MACL online on a **free Oracle Cloud
"Always Free" virtual machine (VM)**, reachable at your own web address over HTTPS. The whole
system (the 3-node Besu chain, the API, and the dashboard) runs on one small server.

**What you need before starting:** a credit/debit card (for identity verification only — you are
not charged on Always Free), and about 1–2 hours the first time.

**How the hosted setup fits together:** one VM runs everything. A small web server called **Caddy**
sits in front. It serves the dashboard files and forwards anything under `/api` to the Node API, all
under one web address over HTTPS. Because the dashboard and the API share the same address, the
dashboard's automatic API selection (added in `dashboard/config.js`) "just works" with no editing.

```
Browser ──HTTPS──▶  Caddy (port 443)  ┬─ "/"      → dashboard files
                                       └─ "/api/*" → Node API (127.0.0.1:3001) → 3 Besu nodes
```

---

## Part 0 — Create a free Oracle Cloud account

1. Go to **https://www.oracle.com/cloud/free/** and click **Start for free**.
2. Enter your email and country (**Rwanda**), and verify the email.
3. Fill in your name and account details.
4. **Choose your Home Region carefully — it is permanent and your free resources live only there.**
   Pick one geographically close to Rwanda for speed. **Johannesburg** (`af-johannesburg-1`) is the
   closest. If you later find the free ARM machines are always "out of capacity" there, a European
   region (Frankfurt or Amsterdam) is a common fallback — but you'd have to make a new account to
   change region, so choose once and stick with it.
5. Verify with your card (a small temporary hold may appear, then disappears; Always Free = no
   charge). Finish and wait a few minutes while Oracle sets up your account.
6. You'll land in the **Oracle Cloud Console** (cloud.oracle.com). That's home base for everything
   below.

> **Capacity tip:** the free ARM machines are popular and sometimes show "Out of host capacity."
> Two fixes: (a) just retry the create button over a few hours, or (b) switch your account to
> **Pay As You Go** (Console → your profile → "Upgrade") — this greatly improves capacity and you
> **still pay nothing** as long as you stay within the Always Free limits.

---

## Part 1 — Create the VM

1. In the Console, open the menu (☰) → **Compute → Instances → Create instance**.
2. **Name:** `macl-server` (anything is fine).
3. **Image and shape → Edit:**
   - **Image:** Canonical **Ubuntu 22.04** (Always Free eligible).
   - **Shape:** click **Change shape → Ampere → VM.Standard.A1.Flex**, then set **OCPUs = 2** and
     **Memory = 12 GB** (the current Always Free maximum). This is plenty for MACL.
4. **SSH keys:** you need a key pair to log in. On your Mac, open a terminal and run:
   ```
   ssh-keygen -t ed25519 -C "macl" -f ~/.ssh/macl_key
   ```
   Press Enter through the prompts (a passphrase is optional). This makes two files:
   `~/.ssh/macl_key` (private — keep secret) and `~/.ssh/macl_key.pub` (public). Back in the Console,
   choose **Paste public keys**, and paste the contents of the **.pub** file. Get it with:
   ```
   cat ~/.ssh/macl_key.pub
   ```
5. **Networking:** leave the default — it creates a virtual network with a **public IPv4 address**
   (make sure "Assign a public IPv4 address" is ticked).
6. Click **Create**. After a minute or two the instance shows **Running** with a **Public IP
   address** — note that number down; you'll use it a lot.

---

## Part 2 — Open the firewall for web traffic (important, easy to miss)

By default only SSH (port 22) is open. You must open **80** and **443** (web/HTTPS) in **two**
places.

**A. Oracle's network security list:**
1. Console → Compute → Instances → click `macl-server` → click its **Virtual Cloud Network** link.
2. Click **Security Lists** → the **Default Security List**.
3. **Add Ingress Rules** (two of them):
   - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**.
   - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**.

**B. Ubuntu's own firewall (the part people forget).** Oracle's Ubuntu image has internal firewall
rules that also block 80/443. After you SSH in (Part 3), run:
```
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Part 3 — Connect to the VM

From your Mac terminal (use the public IP from Part 1):
```
ssh -i ~/.ssh/macl_key ubuntu@YOUR_PUBLIC_IP
```
Type `yes` the first time. You're now on the server (the prompt changes to `ubuntu@macl-server`).
Everything from here runs **on the server**, not your Mac.

First, update the machine:
```
sudo apt update && sudo apt upgrade -y
```

---

## Part 4 — Install Docker and Node.js

Still on the server:

```
# Docker + the compose plugin
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu           # lets you run docker without sudo
newgrp docker                            # apply the group now (or log out/in)

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# check
docker --version && node --version
```

> Your VM is an **Arm** machine. The Besu image and Node are Arm-compatible, so this all works. If
> any `docker compose up` step ever complains about architecture, tell me and we'll pin an Arm tag.

---

## Part 5 — Get the MACL code onto the server

The cleanest way is to push your repo to GitHub (you'll do this for Attempt 1 anyway) and clone it:
```
git clone https://github.com/YOUR_USERNAME/MACL-system.git
cd MACL-system
```

The `.env` files are **not** in the repo (they hold secrets), so create them on the server:

```
# API secrets
cd api
cp .env.example .env
# then edit .env (use: nano .env) and set:
#   JWT_SECRET      -> run `openssl rand -hex 32` and paste the result
#   DONOR_PW_HASH / NGO_PW_HASH / AUDIT_PW_HASH / ADMIN_PW_HASH
#                   -> for each, run: node scripts/hash-password.js 'yourpassword'
#   DATABASE_URL    -> your Neon connection string (or leave blank to run without file storage)
#   CORS_ORIGIN     -> https://YOUR_DOMAIN   (from Part 7; you can set this later)
npm install
cd ..

# Contracts deployer key
cd contracts
cp .env.example .env         # the test deployer key is already in the example
npm install
cd ..

# Evaluation (optional on the server — only if you want to re-run RQ3 here)
```

---

## Part 6 — Start the chain, deploy the contracts, start the API

Still in the repo root on the server:

```
# 1) Start the 3 Besu validators (detached, keeps running)
cd blockchain
./setup-network.sh          # generates a fresh chain + keys for THIS server
docker compose up -d
./check-network.sh          # confirm all 3 validators + rising block height
cd ..

# 2) Deploy + wire the contracts onto this fresh chain
cd contracts
npm run deploy:besu
#   The printed addresses will be the standard fresh-chain ones already in api/.env.example,
#   so you normally don't need to change anything. If they differ, paste them into api/.env.
cd ..

# 3) Run the API as a background service with pm2 (so it survives logout/reboot)
sudo npm install -g pm2
cd api
npm run migrate             # only if you set DATABASE_URL (creates the documents table)
pm2 start server.js --name macl-api
pm2 save
pm2 startup                 # run the line it prints, so the API restarts on reboot
cd ..
```

Quick local check on the server:
```
curl -s http://127.0.0.1:3001/api/health
```
You should see JSON with `"ok":true` and a block number.

---

## Part 7 — Point a web address at it and turn on HTTPS (Caddy)

You need a **domain name** pointing at your VM's public IP. Two options:
- **Free:** create a free subdomain at **https://www.duckdns.org** (sign in, pick a name like
  `macl-yourname`, and set its IP to your VM's public IP). You'll get `macl-yourname.duckdns.org`.
- **Paid (~22,000 RWF, in your proposal budget):** buy a domain and set an **A record** to your VM's
  public IP.

Then install **Caddy**, which serves the dashboard and proxies the API, and gets a free HTTPS
certificate automatically:

```
# install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Create the Caddy config. Run `sudo nano /etc/caddy/Caddyfile` and replace its contents with (use
your real domain):

```
YOUR_DOMAIN {
    handle /api/* {
        reverse_proxy 127.0.0.1:3001
    }
    handle {
        root * /home/ubuntu/MACL-system/dashboard
        file_server
        try_files {path} /index.html
    }
}
```

Then reload Caddy:
```
sudo systemctl reload caddy
```

Caddy automatically fetches a free HTTPS certificate for your domain the first time someone visits.

Finally, set the API's `CORS_ORIGIN` to your domain and restart it:
```
cd ~/MACL-system/api
nano .env          # set CORS_ORIGIN=https://YOUR_DOMAIN
pm2 restart macl-api
```

---

## Part 8 — Verify it's live (your "deployment verified" evidence)

From any browser, open **https://YOUR_DOMAIN**. You should get the MACL sign-in page over HTTPS.
Log in and confirm the connection light goes **green — "connected · block #…"**. Create one record
end-to-end.

**Screenshot this** — the live URL in the address bar, the green connection light, and a record
finalising. Those screenshots are your proof of "deployed and verified in the target environment,"
which the rubric asks for.

---

## Part 9 — Making changes after it's live (recap)

- **Dashboard change:** edit the files → `git pull` on the server (or copy the files) → hard-refresh
  the browser. Seconds. No data affected.
- **API change:** `git pull` → `pm2 restart macl-api`. Seconds. No data affected.
- **Contract change:** you must redeploy (`npm run deploy:besu`), which starts a **fresh, empty**
  ledger at new addresses — so decide contract logic *before* you rely on live data. Update the
  `*_ADDRESS` values in `api/.env` and `pm2 restart macl-api`.
- **Keep it running:** the chain data lives in `blockchain/Node-*/data` on the server. Don't run
  `docker compose down -v` (the `-v` wipes it). A plain reboot is fine — Docker and pm2 restart
  automatically.

---

## Troubleshooting

- **Site won't load at all:** ports 80/443 not open — recheck Part 2 (both the Oracle security list
  *and* the Ubuntu iptables rules).
- **"Out of host capacity" when creating the VM:** retry over a few hours, or switch to Pay As You Go
  (still free within limits).
- **Connection light red / "API unreachable":** the API isn't running (`pm2 status`, then
  `pm2 restart macl-api`) or the Besu containers are down (`docker compose ps` in `blockchain/`).
- **HTTPS certificate error:** your domain isn't pointing at the VM's IP yet, or ports 80/443 are
  closed — Caddy needs port 80 reachable to get the certificate.
- **"no such contract" errors:** the chain was reset without redeploying — run `npm run deploy:besu`
  again and restart the API.
