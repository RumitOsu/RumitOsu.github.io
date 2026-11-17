# Timur Kherlenbayar — portfolio

The source of my personal site, live at https://rumitosu.github.io/. It is a plain static site with no build step and no dependencies, and GitHub Pages serves it straight from the `main` branch.

## What is where

| Path | What it is |
| --- | --- |
| `index.html` | The home page: the welcome, the featured projects, experience, about and contact. All of its wording lives in this file. |
| `projects/index.html` | The page that lists every project as a small card, in groups (featured, then one group per kind of work). |
| `projects/<name>/index.html` | One folder per project. The four featured projects each have a design of their own; the others share one look. |
| `projects/page.css`, `projects/page.js` | The shared look for project pages: the hero, the "short version" box, the story sheet, figures, phone frames, galleries, quotes, method notes and the picture viewer. They load after `style.css` and `app.js`, so they follow the three backdrops. |
| `style.css` | The look of the home page and the projects page. The three colour themes are the variable blocks at the top. |
| `backdrop.js` | The animated background. It paints koi, cranes, clouds and fireflies onto a grid of small character tiles. |
| `app.js` | Theme switching, the pointer light on cards, the small project animations, the filter chips on the projects page, and the copy-email button. |
| `assets/` | The favicon, the fonts (served from here, not from a font service) and the syntax highlighter one project page uses. |

## Adding a project

1. Put the finished page in its own folder, `projects/<name>/index.html`. A page that doesn't need a design of its own links `../page.css` and `../page.js` after the site's own files; the easiest start is to copy another page that uses them.
2. Open `projects/index.html`, find the group the project belongs to, copy one `<li>` block inside it, change the text and the link, and move it to the top of that group. Adding `cool` to the card's class gives it the blue accent. Work without a page of its own gets a `card compact` instead.
3. To start a new group, copy a whole `<section class="group">` block and give it a new `id`, `data-name`, number and count. The filter chips at the top of the page appear by themselves once there are two groups.
4. If the project deserves a large card on the home page, copy one of the `<article class="project">` blocks in `index.html` in the same way.
5. When `style.css`, `app.js`, `page.css` or `page.js` change, raise the `?v=` number where the pages load them, so visitors don't keep an old copy.
6. Commit and push. The live site updates a minute or two later.

## Changing the default backdrop

The site opens on the koi pond. To open on another scene, change `data-theme="pond"` on the `<html>` tag of `index.html` and `projects/index.html` to `steppe` or `embers`. Visitors can switch scenes with the picker in the corner, and their choice is remembered in their own browser.

## Previewing on your own machine

Run `node server.cjs` in this folder and open http://127.0.0.1:4173.

## Motion and accessibility

The background pauses when the tab is hidden and stays still for visitors whose system asks for reduced motion. There is also a "motion" switch in the footer. Every page reads correctly with JavaScript turned off.
