# SPMS+ v2.0 · Deploy a Vercel

Este paquete contiene todo lo necesario para publicar SPMS+ como una
aplicación web real con URL pública.

---

## Estructura del proyecto

```
spms-deploy/
├── index.html           ← entry HTML
├── package.json         ← dependencias (React + Vite)
├── vite.config.ts       ← config del bundler
├── tsconfig.json        ← config TypeScript (relajada)
└── src/
    ├── main.tsx         ← bootstrap React
    └── App.tsx          ← SPMS+ completo (3395 líneas, con shim window.storage)
```

---

## Ruta recomendada: StackBlitz → GitHub → Vercel

### PASO 1 — Subir a StackBlitz (10 minutos)

1. Abre https://stackblitz.com y haz login con tu cuenta de GitHub
   (si no tienes GitHub, créala primero en https://github.com)
2. Click en **"New project"** → **"Vite"** → **"React TypeScript"**
3. Se abre un editor con archivos de ejemplo. Vas a **reemplazarlos** con los
   de este paquete:
   - Borra el contenido de `src/App.tsx` del ejemplo y pega el contenido de
     `src/App.tsx` de este paquete
   - Borra el contenido de `src/main.tsx` del ejemplo y pega el de este paquete
   - Reemplaza el contenido de `index.html`, `package.json`, `vite.config.ts`,
     `tsconfig.json` con los archivos de este paquete
4. StackBlitz reinstalará dependencias automáticamente. Espera 30-60 segundos
5. En el preview de la derecha debes ver la pantalla de login de SPMS+
   - Prueba login local: usuario `admin`, contraseña `spms2024`
   - Si funciona → ✓ estás listo para deploy

### PASO 2 — Conectar a GitHub (5 minutos)

En StackBlitz:
1. Click en el ícono de GitHub (arriba-derecha) → **"Connect Repository"**
2. Nombra el repo: `spms-systenger` → **Private** → **Create**
3. StackBlitz sube todo el código a un repo nuevo en tu cuenta de GitHub

### PASO 3 — Deploy en Vercel (5 minutos)

1. Ve a https://vercel.com → **"Sign up"** → **"Continue with GitHub"**
2. Autoriza Vercel para acceder a tus repos
3. En el dashboard de Vercel → **"Add New"** → **"Project"**
4. Selecciona el repo `spms-systenger` → **Import**
5. Vercel detecta automáticamente que es Vite + React. No cambies nada
6. Click **"Deploy"** y espera 1-2 minutos
7. Te da una URL del tipo `spms-systenger.vercel.app`

### PASO 4 — Conectar a Supabase (2 minutos)

1. Abre tu URL pública de Vercel en el celular o PC
2. En el login, click **"☁ Modo cloud"** → **"⚙ Configurar Supabase"**
3. Pega tu Supabase URL y tu anon public key (las encuentras en
   Supabase → Settings → API)
4. Click **"🔗 Conectar con Supabase"**
5. Ahora usa **"📧 Enviar enlace mágico"** con tu correo
6. Revisa correo, haz clic en el enlace, regresa a la app: estás adentro

### PASO 5 — Promoverte a Sponsor (1 minuto)

En Supabase SQL Editor corre:

```sql
UPDATE public.profiles
SET role = 'sponsor'
WHERE id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1);

SELECT id, name, username, role FROM public.profiles;
```

Cierra sesión en la app y vuelve a loguear. Ya eres sponsor.

---

## Actualizar la app después

Cuando cambies código en StackBlitz:
1. **Commit** dentro de StackBlitz → pushea a GitHub automáticamente
2. Vercel detecta el push y redespliega solo en 1-2 minutos
3. La URL sigue siendo la misma

---

## Notas importantes

**`window.storage` vs `localStorage`.** El código original de Claude Artifacts
usa una API llamada `window.storage` que **no existe** en navegadores normales.
Este paquete incluye un *shim* al principio de `App.tsx` que emula esa API con
`localStorage` del navegador. Sin ese shim, la app no arrancaría.

**Dominio personalizado.** Si quieres `spms.systenger.com` en vez de
`spms-systenger.vercel.app`, en el dashboard de Vercel → Settings → Domains
se configura en 5 minutos. Requiere tener control del DNS de systenger.com.

**Costos.** Vercel gratis aguanta tráfico de equipos internos sin problema
(100 GB de banda al mes). Supabase gratis también aguanta pequeño uso
(500 MB DB + 1 GB storage). Si crece mucho el uso, ambos tienen planes pagos
razonables.

---

SPMS+ v2.0 · SYSTENGER S.A. · *Industrializamos tu obra: más rápido, mejor
y sin sorpresas.*
