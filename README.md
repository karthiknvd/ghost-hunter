# 👻 GHOST HUNTER — Spectral Arcade Experience

[![Project Status: Active](https://img.shields.io/badge/Project%20Status-Active-brightgreen.svg)](https://ghost-hunter.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/karthiknvd/ghost-hunter/blob/main/LICENSE)
[![Technology: Vanilla JS](https://img.shields.io/badge/Technology-Vanilla%20JS-F7DF1E.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Vibe: Cyber-Ethereal](https://img.shields.io/badge/Vibe-Cyber--Ethereal-cyan.svg)](#)

> **"Master the Spectral Blade. Hunt the Phantoms. Save the Living."**

Ghost Hunter is a high-fidelity, rhythm-based arcade slasher built entirely with **Vanilla JavaScript**, **HTML5 Canvas**, and the **Web Audio API**. Experience a world where every slice translates into procedural audio synthesis and cinematic visual feedback.

---

## 🌟 Key Features

### ⚔️ The Spectrum System
Customize your combat experience with the **SPECTRUM** menu. Every blade essence (Cyber, Fire, Mystic, etc.) isn't just a visual change—it includes its own **procedural audio profile**. 
- **Cyber**: Digital sine-wave chirps and square-wave buzz.
- **Fire**: Crackling sawtooth noise and resonant warmth.
- **Mystic**: Ethereal triangle waves with haunting vibrato.

### 👹 Procedural Combat Feedback
No two hits feel the same. 
- **Dynamic Praise**: Your combo streak evolves from `NICE!` to `SPECTRAL!` to `LEGENDARY!`, with colors that shift from Pink to Golden-Yellow.
- **Instant Transitions**: Combat text is optimized to clear instantly on the next hit, ensuring zero clutter during high-speed play.
- **Hit-Stop & Screen Shake**: Every slice has weight, utilizing micro-pauses and directional screen shake for maximum impact.

### 🏆 Multi-Tiered Difficulty
- **EASY**: No miss limit. Perfect for practicing your rhythm and exploring the SPECTRUM.
- **REGULAR**: The standard arcade experience. 3 misses and it's Game Over.
- **HARD**: One miss, and your soul is claimed. High-risk, high-reward.

### 🌫️ Atmospheric UI
- **Glassmorphism**: Menus utilize frosted-glass backgrounds (`backdrop-filter`) and neon glows.
- **Interactive Home Screen**: The main menu title tilts in 3D parallax with your mouse, surrounded by drifting fog and spectral particles.
- **Floating Cursor Spotlight**: A spectral light source follows your cursor, illuminating the dark world of the menu.

---

## 🕹️ Controls

- **Mouse / Touch**: Click and drag to slice through ghosts.
- **ESC / P**: Pause/Resume the game.
- **Hover**: UI buttons emit high-mid "blips" for tactile feedback.
- **Click**: UI interactions trigger resonant triangle-wave selection clicks.

---

## 🚀 Getting Started

No heavy frameworks. No bulky dependencies. Pure web performance.

1. **Clone the repo**
   ```bash
   git clone https://github.com/karthiknvd/ghost-hunter.git
   ```

2. **Run a local server**
   Since the game uses the Web Audio API and certain assets, it's best to run it through a server.
   ```bash
   python -m http.server 8000
   ```

3. **Hunt the Ghosts**
   Open `http://localhost:8000` in your favorite modern browser (Chrome/Edge recommended).

---

## 🎧 Audio Engine Deep-Dive

The audio in Ghost Hunter is **100% synthesized in real-time**. We do not use static MP3 samples for combat.
- **Blade Loop**: A continuous speed-sensitive oscillator that shifts in pitch and volume based on your mouse velocity.
- **Thematic Synthesis**: The `getBladeAudioProfile` function defines the "soul" of each blade, manipulating oscillator types, resonance (Q), and gain envelopes on the fly.
- **Autoplay Handling**: Implements a global "Unlock Audio" listener to comply with modern browser security while ensuring a seamless experience.

---

## 📂 Project Structure

```text
ghost-hunter/
├── index.html     # Semantic HTML5 structure & UI overlays
├── style.css     # Advanced CSS3 with neon variables & glassmorphism
├── game.js      # Core Engine: Canvas render, Physics, & Audio Synthesis
└── README.md    # You are here!
```

---

## 📜 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ for the Ethereal Hunters. 👻
</p>
