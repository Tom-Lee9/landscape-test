# Alpine Lake VR

A first-person walk around a mountain lake for an iPhone in a slide-in (Cardboard-style) VR headset.
It's a separate project from `vr-fishing`, and the two share no files.

## What's in it
- About 12 × 12 km of generated terrain. There's a clear alpine lake in the middle, cliff-banded peaks with snow, and a valley that opens to the south.
- Thousands of instanced pine trees (detailed close up, simpler far away), plus boulders and four waterfalls with spray.
- A physically based sky, drifting clouds, distance haze and low valley mist.
- Real-time lake reflections. You can see the lake bed and caustics through the shallows.
- Sound made live in the browser (no audio files): gusty wind, pine hiss, lapping water, a waterfall roar that pans as you turn, and birdsong.
- **Play**: normal full-screen view. **VR Mode**: side-by-side stereo with head tracking. **Settings**: quality, mute, walk speed, IPD, VR field of view, FPS counter.

## Controls
| | Phone, Play | Phone, VR Mode | PC |
|---|---|---|---|
| Look | move the phone (or drag) | turn your head | drag the mouse |
| Walk | hold **Hold to walk** | hold a finger anywhere on the screen | WASD / arrows (Shift to run) |
| Face the lake | | two-finger tap | |
| Menu / mute | ✕ / 🔊 buttons | same (small, top middle) | Esc / M |

## Reading a book
1. In the menu tap **Load book (PDF)** and pick a PDF from Files. It stays on your phone and nothing is uploaded. The game remembers the book and your page.
2. In-game, tap **📖** to open or close the book. It appears at lap height, so look down to read.
3. **Play mode:** ◀ ▶ turn pages, 🔍 zooms into one big page. **VR:** tap for the next page, look at the left page and tap to go back, two-finger tap to zoom, hold to walk. **PC:** B for the book, [ and ] to turn pages, Z to zoom.
- For real reading, use **zoom**. A full page at book size is too small to read clearly in a phone headset.
- **Never upload a book PDF to the GitHub repo.** It's public, so anyone could download it. `.gitignore` blocks PDFs from being committed.

## Run it on the PC
You need a local web server, because ES modules don't load from `file://`. Node is installed, so in this folder run:
```
npx http-server -p 8080 -c-1
```
Then open http://localhost:8080.

## Run it on the iPhone (needs https)
iPhone Safari only gives motion sensors to **https** pages, so host it the same way as vr-fishing:
1. Make a new GitHub repo, e.g. `vr-mountains`, and upload everything in this folder (`index.html`, `js/`, `lib/`, `textures/`).
2. Go to repo **Settings → Pages**, choose **Deploy from branch → main / root**.
3. Open `https://tom-lee9.github.io/vr-mountains/` in Safari.
4. Tap **Share → Add to Home Screen** and launch it from there. That hides Safari's bars, so the stereo view fills the screen.

## iPhone permissions
- **Motion & Orientation**: when you tap **Play** or **VR Mode**, iOS asks "allow access to motion and orientation". Tap **Allow**. Without it, head tracking is off and you can only drag to look.
  - If you tapped Don't Allow, iOS remembers that. To get the prompt back, close the tab and open the page again. If it still doesn't ask, go to **Settings → Apps → Safari → Clear History and Website Data**.
- **Sound**: Web Audio only starts after a tap, which the Play/VR buttons handle. If you hear nothing, check the **silent switch** on the side of the phone, because iOS mutes web audio when it's on.
- **Screen sleep**: the game asks for a screen wake lock. If your iOS version doesn't support it, set Auto-Lock to Never while playing.

## Performance tips
- Default quality is **Medium** on phones. If it stutters, use **Low**. **High** is for PC.
- The game lowers its resolution by itself if the frame rate drops below about 40 fps.
- Low Power Mode caps the iPhone at 30 fps, so turn it off.

## Files
- `index.html`: page, menu, settings, styles
- `js/main.js`: renderer, stereo cameras, input, walking, menu logic
- `js/world.js`: terrain, lake, trees, rocks, waterfalls, sky, clouds and the shaders
- `js/vr.js`: phone orientation → head rotation
- `js/audio.js`: generated ambient sound
- `js/book.js`: PDF → 3D book (page textures, page turns, zoom, bookmark)
- `lib/pdfjs/`: PDF.js 3.11.174 (Apache-2.0, Mozilla)
- `lib/`: three.js r160 (MIT): `three.module.js`, `Water.js`, `Sky.js`, `BufferGeometryUtils.js`

## Asset credits
- Textures from [Poly Haven](https://polyhaven.com) (CC0): `aerial_grass_rock`, `rock_face` (colour + normal), `snow_02`, `forest_ground_04`, all 1k JPG.
- `waternormals.jpg` from the three.js examples (MIT).

## Honest limits
- It's a phone browser, so this isn't film-quality photorealism. There are no real-time shadows, and the trees are built from shapes rather than scanned models.
- There's no lens distortion correction. Most cheap headsets look fine without it. If edges look bent, lower the VR field of view in Settings.
