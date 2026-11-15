# Timur Kherlenbayar — portfolio

The source of my personal site, live at https://rumitosu.github.io/. It is a plain static site with no build step and no dependencies, and GitHub Pages serves it straight from the `main` branch.

## What is where

| Path | What it is |
| --- | --- |
| `index.html` | The home page: the welcome, two featured projects, experience, about and contact. All of its wording lives in this file. |
| `projects/index.html` | The page that lists every project as a small card. |
| `projects/<name>/index.html` | One folder per project, each a self-contained page with its own design. |
| `style.css` | The look of the home page and the projects page. The three colour themes are the variable blocks at the top. |
| `backdrop.js` | The animated background. It paints koi, cranes, clouds and fireflies onto a grid of small character tiles. |
| `app.js` | Theme switching, the pointer light on cards, the two small project animations, and the copy-email button. |
| `assets/` | The favicon, the fonts (served from here, not from a font service) and the syntax highlighter one project page uses. |

## Adding a project

1. Put the finished page in its own folder, `projects/<name>/index.html`.
2. Open `projects/index.html`, copy one `<li>` block inside the list, change the text and the link, and move it to the top of the list. Adding `cool` to the card's class gives it the blue accent.
3. If the project deserves a large card on the home page, copy one of the `<article class="project">` blocks in `index.html` in the same way.
4. Commit and push. The live site updates a minute or two later.

## Changing the default backdrop

The site opens on the koi pond. To open on another scene, change `data-theme="pond"` on the `<html>` tag of `index.html` and `projects/index.html` to `steppe` or `embers`. Visitors can switch scenes with the picker in the corner, and their choice is remembered in their own browser.

## Previewing on your own machine

Run `node server.cjs` in this folder and open http://127.0.0.1:4173.

## Motion and accessibility

The background pauses when the tab is hidden and stays still for visitors whose system asks for reduced motion. There is also a "motion" switch in the footer. Both pages read correctly with JavaScript turned off.
