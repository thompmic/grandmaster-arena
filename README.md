# Grandmaster Arena

A browser chess duel in a 3D colosseum. The Node server owns rooms, validates every move with `chess.js`, and broadcasts room snapshots and timestamped cinematic events through Socket.IO.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://localhost:3000>. Create an arena in one browser, then use the four-letter code from another browser to join as the opposing player. A third browser joins as a spectator. The first connection gets White; the next gets Black.

## Deploy a public link free on Render

Render supports Node web services and WebSocket connections. This repository includes `render.yaml`, which defines the free service. Render's free service can sleep after 15 minutes without inbound traffic; its first request after sleep may take about a minute to wake. Active WebSocket messages keep the service active. In-memory rooms reset if the server restarts or sleeps.

1. Create a GitHub repository named `grandmaster-arena` (choose **Private** or **Public**) and leave **Add a README** unchecked.
2. From a terminal, go to this folder and push the files (replace `YOUR-USERNAME`):

   ```sh
   cd path/to/outputs/grandmaster-arena
   git init -b main
   git add .
   git commit -m "Build Grandmaster Arena"
   git remote add origin https://github.com/YOUR-USERNAME/grandmaster-arena.git
   git push -u origin main
   ```

3. Sign in at [Render](https://render.com) with GitHub. In the dashboard, choose **New → Blueprint**, connect the `grandmaster-arena` repository, and deploy the detected `render.yaml`.
4. Render will show the app's public `onrender.com` URL when the deploy finishes. Open it and choose **Create Arena**.

To invite players or spectators, share the public URL and four-letter arena code. The **copy** button in the room header copies a direct link with that code filled in.

## Play

- Players select a piece and then a destination. The server enforces legal chess moves, including castling, en passant, and promotion; enter `q`, `r`, `b`, or `n` when prompted for a promotion.
- Choose a champion theme, optional five- or ten-minute clock, and spectator camera seat.
- Spectators can cheer or boo. Server reactions update the shared hype level and appear over the arena.
- Settings include cinematic skip and voice commentary. The operating system's reduced-motion preference is respected.

## Notes

- Rooms are held in the running process's memory. This single-instance setup is intended for a demo or submission; restarting the service clears rooms and games.
- Three.js and its camera controls load from jsDelivr, and display fonts load from Google Fonts.
- Original arena and champion visuals are built from Three.js primitives.
