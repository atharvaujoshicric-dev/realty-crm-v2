# RealtyFlow CRM — Final

## Setup Steps

### 1. Run schema in Supabase SQL Editor
Paste entire `sql/schema.sql` and click Run.

### 2. Create SuperAdmin
```sql
SELECT public.create_crm_user(
  'your@email.com',
  'YourPassword123',
  'Super Admin',
  'superadmin'
);
```

### 3. Supabase Settings
- **Authentication → Sign In / Sign Up → Email → Confirm email: OFF**
- **Authentication → URL Configuration → Site URL:** `https://yourusername.github.io`

### 4. Push to GitHub
```bash
git init && git add . && git commit -m "RealtyFlow CRM"
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

### 5. Enable GitHub Pages
Settings → Pages → Deploy from main branch → root

---

## Credentials
Update `SB_URL` and `SB_KEY` in `js/app.js` lines 4-5 if you change your Supabase project.

## Roles
- **SuperAdmin**: Create/delete projects, manage all users, import Excel
- **Project Admin**: Full CRUD on project, manage project users, settings
- **Sales**: View only (Dashboard, Bookings, Pipeline, Cheques, Analytics)
