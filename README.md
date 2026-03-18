# RealtyFlow CRM v2

Generic multi-project real estate CRM. Supabase backend. GitHub Pages hosting.  
No build step. No Node.js. Pure HTML + CSS + JS.

---

## Architecture

```
GitHub Pages (static HTML/CSS/JS)
        ↕
Supabase (Postgres + Auth + Row Level Security)
```

---

## Deploy in 5 Steps

### 1 · Create Supabase Project
1. Go to **[supabase.com](https://supabase.com)** → New Project
2. Choose a name, strong password, region closest to your users
3. Wait ~2 minutes for provisioning

### 2 · Run the Schema
1. Supabase Dashboard → **SQL Editor** → New Query
2. Paste the entire contents of **`sql/schema.sql`**
3. Click **Run** — all tables, policies, and functions are created

### 3 · Create SuperAdmin
In Supabase SQL Editor, run:
```sql
-- Step A: create auth user
SELECT public.create_crm_user(
  'superadmin@yourcompany.com',  -- email
  'YourStrongPassword123',       -- password (min 8 chars)
  'Super Admin',                 -- display name
  'superadmin'                   -- role
);
```
That's it. The function handles both the auth user and the profile.

### 4 · Push to GitHub
```bash
# In the realty-crm-v2 folder:
git init
git add .
git commit -m "RealtyFlow CRM v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 5 · Enable GitHub Pages
- GitHub repo → **Settings** → **Pages**
- Source: **Deploy from branch** → `main` → `/ (root)` → **Save**
- Your app: `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### 6 · First Login
1. Open your GitHub Pages URL
2. Click **"Set credentials →"**
3. Enter from Supabase → **Settings → API**:
   - **Project URL** (e.g. `https://abc.supabase.co`)
   - **Anon Public Key**
4. Click **Save & Connect**
5. Log in with your superadmin email + password

---

## Role System

| Role | Access |
|------|--------|
| **SuperAdmin** | Create/edit any project, manage all users, view all data |
| **Project Admin** | Full CRUD on their project + settings + custom fields |
| **Sales** | View + download only: Dashboard, Bookings, Pipeline, Cheques, Analytics |

---

## Creating Projects & Users

### From SuperAdmin dashboard:
1. Click **"＋ New Project"**
2. Fill in project details + financial defaults
3. Enter **Project Admin** credentials (required)
4. Enter **Sales login** credentials (optional)
5. Click **Create Project** — users are provisioned automatically

### Adding more users later:
- SuperAdmin: **All Users** → **＋ Add User**
- Project Admin: **Settings** → **Project Users** → **＋ Add User**

---

## Custom Fields

Project admins can add any extra fields per project:

1. **Settings** → **Custom Fields** → **＋ Add Field**
2. Choose label, type (text / number / date / dropdown / textarea / yes-no)
3. Choose whether it applies to **Booking** or **Cheque**
4. The field immediately appears in:
   - The add/edit form
   - The data table column
   - Exported CSV

---

## Analytics & Downloads

- **Analytics** tab: 6 charts (Status distribution, Bank breakdown, Monthly trend, Value by bank, Disbursement status, Payment collections)
- Every chart has a **⬇ PNG** button — downloads a high-quality PNG
- Every data page (**Bookings**, **Cheques**, **Prev Team**) has **⬇ Export CSV**
- Exports include all standard + custom field columns

---

## File Structure

```
realty-crm-v2/
├── index.html        # Complete app — all pages + all modals
├── css/
│   └── style.css     # All styles
├── js/
│   └── app.js        # All logic + Supabase + Charts + Export
└── sql/
    └── schema.sql    # Full DB schema + RLS policies + functions
```

---

## Security Notes

- **Row Level Security** is ON for every table
- Users see only their assigned projects
- SuperAdmin bypasses RLS via `SECURITY DEFINER` functions
- The Supabase **anon key** is safe to expose — it cannot bypass RLS
- Passwords are hashed by Supabase Auth (bcrypt)
- Credentials stored in browser localStorage — never sent to any third party

---

## Local Development

```bash
# No npm needed. Just serve the files:
npx serve .
# or
python3 -m http.server 8080
# or just open index.html in a browser (note: Supabase calls require HTTPS or localhost)
```
