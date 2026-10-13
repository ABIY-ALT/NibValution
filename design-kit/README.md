# NIB Design Kit

The colours, dark mode, shadows, hexagon texture, application shell and core
components of the NIB Property Valuation system, packaged to reuse in another
system.

Open `preview.html` in a browser to see everything working. Make the window
narrower than 1024px to see the navigation become a drawer. Useful address
options: `?theme=dark`, `?sidebar=collapsed`, `?drawer=open` (small screens).

## What's in the folder

| File                      | What it is                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `nib-tokens.css`          | All colours, shadows, radii and type sizes as CSS variables, light and dark. **Always needed.** |
| `nib-components.css`      | Ready-made classes (`nib-card`, `nib-btn`, `nib-sidebar`...) for projects **without** Tailwind. |
| `nib-tailwind.css`        | Tailwind v4 theme and utilities, for projects **with** Tailwind.                   |
| `textures/hex-relief.webp`| The hexagon background used in the sidebar and content area.                        |
| `react/hex-relief.tsx`    | The hexagon texture layers as React components, for projects **with** Tailwind.    |
| `nib-logo.png`            | The NIB mark.                                                                       |
| `preview.html`            | Working demo page and copy-paste template.                                          |

Copy the whole `design-kit` folder into the other project first, then follow
**one** of the options below.

---

## The application shell

Both options build the same layout as NIB Property Valuation:

- **1024px and wider:** a 272px navigation rail on the left. The gold button on
  its edge collapses it to 72px of icons, and the browser remembers the choice.
- **Below 1024px:** the rail is hidden. A menu button at the left of the header
  opens it as a drawer over the page, with a blurred scrim behind it. The
  close button, the scrim, the Escape key and choosing a link all close it.
  The collapsed setting does not apply to the drawer, which always shows
  labels.
- **The header** is a white card floating above the page. It holds search on
  the left, and round icon buttons and the account avatar on the right. It
  carries no page title. Each page states its own title once, in the page hero.
- **The page** fills the column, with a 24px gutter (16px below 640px). It is
  never centred: centring opened a gap beside the rail that grew on wide
  screens. Pages of forms and settings may be capped at 1280px, still anchored
  to the left.
- **The hexagon texture** runs faintly behind the rail (30% in light, 15% in
  dark, so the menu labels stay the focus) and frames the page from two
  opposite corners. The strengths are the `--nib-relief-*` tokens in
  `nib-tokens.css`; change them there, not in the components.
- **Dialogs cover everything, rail included.** The content column is
  deliberately not a stacking context (no `isolation`, no `z-index`), so a
  dialog rendered inside a page still lands above the rail. The page texture
  sits beneath the page by coming first in the column instead.

---

## Option A - Any web project, no Tailwind

Works with plain HTML, PHP/Laravel, Django, ASP.NET, Angular, Vue, React, or
anything else that serves HTML.

1. Put the folder where the project serves static files (for example
   `public/nib/` or `static/nib/`). Keep `textures/` beside the CSS files.
2. Link the two stylesheets, tokens first:

   ```html
   <link rel="stylesheet" href="/nib/nib-tokens.css" />
   <link rel="stylesheet" href="/nib/nib-components.css" />
   ```

3. Build the page from the classes. `preview.html` has every piece; copy the
   parts you need:

   ```html
   <div class="nib-shell">
     <aside class="nib-sidebar" id="nib-rail">
       <div class="nib-rail-relief"></div>            <!-- hexagon texture -->
       <div class="nib-sidebar__brand">
         ...logo...
         <button class="nib-sidebar__close" type="button"
                 aria-label="Close navigation">...x...</button>   <!-- drawer only -->
       </div>
       <button class="nib-sidebar-toggle" type="button" aria-pressed="false"
               aria-label="Collapse navigation">        <!-- gold collapse button -->
         <svg>...chevron-left...</svg>
       </button>
       <nav class="nib-nav">
         <h2 class="nib-nav__title">Overview</h2>
         <a class="nib-nav__item" aria-current="page" href="/">
           <svg class="nib-nav__icon">...</svg>
           <span class="nib-nav__label">Dashboard</span>
         </a>
         <a class="nib-nav__item" href="/tasks">
           <svg class="nib-nav__icon">...</svg>
           <span class="nib-nav__label">My Tasks</span>
           <span class="nib-nav__count">4</span>
         </a>
       </nav>
     </aside>
     <div class="nib-scrim"></div>                    <!-- drawer backdrop -->

     <div class="nib-column">
       <div class="nib-ground-relief">                <!-- hexagon texture -->
         <div class="nib-ground-relief__a"></div>
         <div class="nib-ground-relief__b"></div>
       </div>
       <div class="nib-header-band">
         <header class="nib-header">
           <button class="nib-header-btn nib-menu-button" type="button"
                   aria-controls="nib-rail" aria-expanded="false"
                   aria-label="Open navigation">...menu...</button>
           <form class="nib-header-search" role="search">...</form>
           <div class="nib-header__actions">...icon buttons, avatar...</div>
         </header>
       </div>
       <main class="nib-main">
         <div class="nib-page nib-stack">
           <header class="nib-hero">
             <div class="nib-hero__text">
               <h1 class="nib-page-title">Dashboard</h1>
             </div>
           </header>
           ...your page...
         </div>
       </main>
     </div>
   </div>
   ```

   Mark the current page's menu link with `aria-current="page"` (or the class
   `is-active`). It then gets the gold highlight and edge marker. Mark exactly
   one: the longest link that is the current address or a parent of it, so
   `/requests/new` lights *New Request*, not *Requests* as well.

   Keep `nib-ground-relief` the **first** child of `nib-column`, and do not add
   `isolation` or a `z-index` to the column: the texture is kept beneath the
   page by that order, and an isolated column would trap dialogs below the
   rail.

4. **The scripts.** `preview.html` has two short scripts to copy:
   - **Collapse** (just after `</aside>`): toggles `is-collapsed` on
     `.nib-sidebar`, flips `aria-pressed` and the button's label, gives each
     link a hover tooltip while collapsed, and remembers the choice in
     `localStorage`. Wrap each menu label in `nib-nav__label`, because that is
     the part that hides.
   - **Drawer** (end of `<body>`): toggles `is-open` on `.nib-sidebar` from the
     menu button. It closes on the close button, the scrim, Escape or a link,
     and moves focus into the drawer and back. The scrim must come directly
     after the `<aside>`.

   In a framework, you can call `rail.classList.toggle('is-collapsed')` or
   `rail.classList.toggle('is-open')` from your own click handlers instead.

5. **Pages of forms or settings** can be capped at 1280px without being
   centred: `<div class="nib-page"><div class="nib-page__capped">...</div></div>`.

### Class reference

| Use                | Classes                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Shell              | `nib-shell`, `nib-column`, `nib-header-band`, `nib-main`, `nib-page` (+ `nib-page__capped`), `nib-stack` (24px between sections), `nib-scrim` |
| Sidebar            | `nib-sidebar` (+ `is-collapsed`, `is-open`), `nib-sidebar-toggle`, `nib-sidebar__close`, `nib-nav__item`, `nib-nav__icon`, `nib-nav__label`, `nib-nav__count` |
| Header             | `nib-header`, `nib-menu-button`, `nib-header-search`, `nib-header__actions`, `nib-header-btn` (+ `nib-header-btn__count`), `nib-avatar` |
| Page hero          | `nib-hero`, `nib-hero__text`, `nib-hero__eyebrow`, `nib-page-title`, `nib-hero__subtitle`, `nib-hero__actions` |
| Card               | `nib-card` (+ `nib-card--interactive` for a card that is a link), with `nib-card__bar`, `nib-card__title`, `nib-card__description`, `nib-card__body`, `nib-card__footer`; `nib-icon-plate` (+ `--danger`, `--info`, `--good`) |
| Stat tile          | `nib-stat-grid` > `nib-card nib-stat` (+ `--brand`, `--good`, `--warning`, `--danger`, `--info`), with `nib-stat__icon`, `nib-stat__label`, `nib-stat__value`, `nib-stat__unit`, `nib-delta` (+ `--good`, `--bad`), `nib-stat__meta` |
| Button             | `nib-btn` (gold), plus `--accent`, `--outline`, `--secondary`, `--ghost`, `--link`, `--danger`, `--soft-danger`; sizes `--sm`, `--lg`, `--icon` |
| Form               | `nib-label`, `nib-input`, `nib-select`, `nib-textarea`, `nib-hint` (`aria-invalid="true"` shows an error) |
| Status pill        | `nib-badge`, plus `--inactive`, `--info`, `--active`, `--waiting`, `--warning`, `--success`, `--danger`, `--brand` |
| Table              | `nib-table-wrap` > `nib-table-bar` + `nib-table-scroll` > `nib-table`; `nib-num` for right-aligned amounts |
| Utilities          | `nib-tabular` (aligned figures), `nib-scroll-quiet` (scrollbar shows on hover), `nib-no-print` |

## Option B - Tailwind v4 project (React, Next.js, Vite, Vue...)

1. Copy `nib-tokens.css` and `nib-tailwind.css` next to the main stylesheet,
   for example into `src/styles/nib/`.
2. Copy `textures/hex-relief.webp` to `public/textures/hex-relief.webp`, and
   `nib-logo.png` to `public/nib-logo.png`.
3. In the main stylesheet (`globals.css`, `app.css`, `index.css`):

   ```css
   @import 'tailwindcss';
   @import './nib/nib-tokens.css';
   @import './nib/nib-tailwind.css';
   ```

4. Use the same class names as the NIB Property Valuation code: `bg-app`,
   `bg-surface`, `text-ink`, `text-ink-3`, `border-line`, `shadow-card`,
   `bg-nib-gold-500`, `text-nib-brown-900`, `bg-nib-gold-500/15`,
   `bg-st-done-bg text-st-done`, `rounded-(--radius-card)`, `text-section`.
   Text on a solid status fill uses the matching `text-on-*` colour -
   `bg-st-late text-on-late`, never `text-white`: the dark-mode fills are
   light, and white on them is unreadable.
   The shadcn/ui names (`bg-primary`, `bg-card`, `text-muted-foreground`,
   `border-border`) are mapped to NIB colours too. The shell's utilities,
   `page-enter`, `scroll-quiet`, `no-print`, `hex-relief` and `tabular`, are
   included.

**React projects can copy the components themselves** from the NIB Property
Valuation codebase, unchanged:

| Component                                   | File                                            |
| ------------------------------------------- | ----------------------------------------------- |
| Button, Card, Badge, Input/Select, Table, StatCard... | `src/components/ui/*.tsx`             |
| Page hero                                   | `src/components/layout/page-hero.tsx`           |
| Sidebar (collapsible, mobile drawer)        | `src/components/navigation/sidebar.tsx`         |
| Shell layout (rail, floating header, page)  | `src/app/(app)/layout.tsx`                      |
| Hexagon texture layers                      | `react/hex-relief.tsx` in this kit (reads the `--nib-relief-*` tokens) |
| Light / dark / system switch                | `src/context/theme-context.tsx`, `src/components/theme-switch.tsx` |
| `cn()` helper                               | `src/lib/utils.ts`                              |

Wiring the sidebar:

- Wrap the shell in `<ShellProvider>` from `sidebar.tsx`. It holds the
  collapsed and drawer states, closes the drawer on navigation and Escape, and
  locks page scrolling while the drawer is open.
- Nothing opens the drawer by itself. Your header needs a button, shown below
  `lg`, that calls `useShell().setMobileOpen(true)`. Without it, small screens
  have no navigation:

  ```tsx
  const { setMobileOpen } = useShell();
  <button type="button" onClick={() => setMobileOpen(true)} className="lg:hidden">
    <Menu aria-hidden="true" /><span className="sr-only">Open navigation</span>
  </button>
  ```

- `layout.tsx` is a reference for the structure rather than a drop-in file. It
  loads NIB's session, badges and notifications, so keep its markup and
  replace the data calls with your own.
- Keep the content column free of `isolate` and any `z-index`, with
  `<GroundRelief />` first in it and `relative` on `<main>`. The placement is
  spelled out at the end of `react/hex-relief.tsx`. With `isolate`, a dialog
  rendered inside a page stays below the rail.

The components need these packages:

```bash
npm install clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-slot
```

Some components also use other `@radix-ui/*` packages (dialog, dropdown-menu,
tooltip, select). Install whichever their imports name. `sidebar.tsx`,
`stat-card.tsx` and `nib-logo.tsx` use Next.js `Link`/`Image`. In a non-Next
project, swap them for your router's link and a plain `<img>`.

## Option C - Tailwind v3, Bootstrap, MUI, Ant Design...

Load `nib-tokens.css` globally, then point the library's theme at the
variables or the hex values below. For the shell (rail, drawer, header), add
`nib-components.css` too and use its classes from Option A; its `nib-`
prefix keeps it clear of the library's own classes.

**Tailwind v3** (`tailwind.config.js`), with `darkMode: 'class'`:

```js
theme: {
  extend: {
    colors: {
      app: 'var(--nib-app)', surface: 'var(--nib-surface)', line: 'var(--nib-line)',
      ink: { DEFAULT: 'var(--nib-ink)', 2: 'var(--nib-ink-2)', 3: 'var(--nib-ink-3)' },
      nib: { gold: { 500: '#d89a16', 400: '#f3bd28', 700: '#96751f' }, brown: { 900: '#3a1c05', 800: '#4b2507' } },
    },
    boxShadow: { card: 'var(--nib-shadow-card)', raised: 'var(--nib-shadow-raised)' },
  },
},
```

(Opacity modifiers like `bg-ink/50` don't work with CSS-variable colours in
v3. Use the hex value where you need them.)

**MUI** (`createTheme`): `primary.main: '#d89a16'`,
`primary.contrastText: '#3a1c05'`, `secondary.main: '#4b2507'`,
`background.default: '#f6f6f3'`, `background.paper: '#ffffff'`,
`text.primary: '#2a1b0c'`, `shape.borderRadius: 6`. Dark:
`background.default: '#1a130c'`, `background.paper: '#241a11'`,
`text.primary: '#f5ede1'`.

**Bootstrap 5**: `--bs-primary: #d89a16; --bs-body-bg: var(--nib-app);
--bs-body-color: var(--nib-ink); --bs-border-color: var(--nib-line);`

---

## Dark mode

Put `class="dark"` (or `data-theme="dark"`) on `<html>`; everything follows.
`preview.html` has a small script that remembers the choice and follows the
operating system until the user picks one. Run it in `<head>` so the page never
flashes light first.

## Printing

The rail, header, drawer and textures are left off the printout, and the page
lets go of the screen height so long pages print in full. Add `nib-no-print`
(or `no-print` with Tailwind) to anything else that should not print, such as
action buttons.

## Main colours

| Role                    | Light     | Dark      |
| ----------------------- | --------- | --------- |
| Brand gold (primary)    | `#d89a16` | `#d89a16` |
| Brand brown             | `#4b2507` | `#4b2507` |
| Deep brown (text on gold) | `#3a1c05` | `#3a1c05` |
| Page background         | `#f6f6f3` | `#1a130c` |
| Card / surface          | `#ffffff` | `#241a11` |
| Border                  | `#eae7e0` | `#3d2e20` |
| Text                    | `#2a1b0c` | `#f5ede1` |
| Muted text              | `#8a7862` | `#9a876f` |
| Success                 | `#047857` | `#4fbf8b` |
| Warning / in review     | `#b45309` | `#e0a33c` |
| Danger / overdue        | `#b91c1c` | `#f08a85` |
| Info                    | `#2563eb` | `#7ea6f5` |

The full list, including the background tints for each status, is in
`nib-tokens.css`.

## Keeping it in sync

This kit is a copy of the NIB Property Valuation theme and shell as of
1 October 2026: `src/app/globals.css` (colours, utilities),
`src/components/navigation/sidebar.tsx` (rail and drawer),
`src/app/(app)/layout.tsx` (shell and gutters),
`src/components/layout/app-header.tsx`, `page-hero.tsx`, `hex-relief.tsx` and
`src/components/ui/*`. If one of those changes, change the matching part of the
kit too.

**Updated 5 October 2026**, following NIB Request and NIB Board: the hexagon
texture behind the rail is fainter (30% light, 15% dark, from 90% and 45%), its
strengths are tokens (`--nib-relief-*`), the page's second texture fragment is
dropped below 1024px rather than 768px, and the content column is no longer a
stacking context, so dialogs cover the rail. Text on solid status fills takes
the new `--nib-on-*` colours (`text-on-late` with Tailwind), so a danger button
or count pill stays readable in dark mode. NIB Property Valuation was brought
in line the same day.
