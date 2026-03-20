# RealtyFlow CRM - Song of the River Edition

A complete CRM system optimized for real estate project management and booking tracking, specifically designed for the Song of the River project.

## 🎯 Features

### 📊 Excel Import
- **BWxSOTR Sheet Support**: Direct import from Song of the River master export
- **Auto-Detection**: Automatically identifies and maps columns
- **Smart Filtering**: Skips calculated columns (total cost, received, etc.)
- **Batch Processing**: Efficient 50-row chunk insertion
- **Progress Tracking**: Real-time import status updates

### 👥 Team Management
- **User Creation**: Quick add team members with email & password
- **Role-Based Access**: Superadmin, Admin, Sales roles
- **Project Assignment**: Auto-assign users to projects
- **Password Management**: Secure password hashing with bcrypt

### 🏢 Client Management
- **Quick Client Addition**: Fast client onboarding
- **Contact Tracking**: Phone, email, plot assignment
- **Agreement Tracking**: Loan status, disbursement tracking
- **Document Management**: File submission tracking

### 📈 Dashboard
- **KPI Cards**: Total bookings, booking value, completion rate
- **Booking List**: Sorted by serial number
- **Bank Tracking**: Loan status by bank
- **Status Filtering**: View by agreement status

### 🧾 Supporting Records
- **Cheque Details**: Payment and cheque tracking
- **Previous Team**: Legacy booking records
- **Custom Fields**: Project-specific data extension

## 🚀 Quick Start

### 1. Prerequisites
- Supabase account (free tier works)
- Web server or local development server
- Modern web browser

### 2. Setup Database

In Supabase SQL Editor:

```bash
# Step 1: Run schema.sql
# Creates all tables and functions

# Step 2: Run fix_login.sql
# Sets up authentication workflows

# Step 3: Create first superadmin user
SELECT public.create_crm_user(
  'your@email.com',
  'YourPassword123!',
  'Your Name',
  'superadmin'
);
```

### 3. Deploy Frontend

```bash
# Copy files to your web server:
- index.html
- app.js
- style.css

# Files MUST be in root directory, not in /css/ or /js/ folders!
```

### 4. Update Credentials

In `app.js`, lines 7-8:
```javascript
const SB_URL = 'your-supabase-url';
const SB_KEY = 'your-supabase-key';
```

Get these from: Supabase Dashboard → Settings → API

### 5. Login & Test

1. Open the app in browser
2. Login with superadmin credentials
3. Try importing the Song of the River Excel file
4. Add test users and clients

## 📁 File Structure

```
realtyflow-crm-production/
├── index.html                    # Main HTML interface
├── app.js                        # Application logic (optimized)
├── style.css                     # Styling
├── schema.sql                    # Database schema
├── fix_login.sql                 # Auth setup
├── fix_missing_profiles.sql      # Profile creation
├── index.ts                      # Edge Function code
├── IMPORT_MAPPING.json           # Column mapping reference
├── OPTIMIZATION_NOTES.md         # Detailed optimization info
├── README.md                     # This file
└── .gitignore                    # Git ignore rules
```

## 📊 Import Process

### Step 1: Select Project
Choose the target project for import

### Step 2: Upload File
Drag & drop or click to upload Song of the River XLSX file

### Step 3: Map Columns
- Auto-detection maps columns for BWxSOTR sheet
- Manually change mappings if needed
- Preview shows first 3 rows

### Step 4: Preview
- Summary of rows to import
- Shows sheet name, type, and row count

### Step 5: Import
- Batch processing (50 rows at a time)
- Real-time progress bar
- Success/error counts

## 👥 User Management

### Add User (Quick Method)
1. Dashboard → "Add Team Member"
2. Enter: Name, Email, Password
3. Auto-assigns to current project
4. Instant feedback via toast

### Create User (Admin)
1. Admin → Platform Users → "Add User"
2. Select role (superadmin, admin, sales)
3. Assign to projects
4. Send credentials to user

### User Roles
- **Superadmin**: Full access, user management
- **Admin**: Project management, user management
- **Sales**: View/edit bookings for assigned projects

## 🏡 Client Management

### Add Client (Quick Method)
1. Dashboard → "Add New Client"
2. Enter: Name, Plot No., Contact (optional)
3. Auto-set: Booking date = today, Status = "File Given"
4. Appears in booking list immediately

### Edit Booking
1. Click ✏️ on booking row
2. Update: Values, banks, dates
3. Save changes
4. Auto-updates dashboard

## 🔧 Configuration

### Project Settings
Edit in SQL or Admin panel:
```sql
UPDATE projects SET
  developer = 'Beyond Walls',
  rera = 'Registration Number',
  total_plots = 200,
  launch_date = '2024-01-01'
WHERE name = 'Song of the River';
```

### Custom Fields
Add project-specific fields for bookings/cheques:
- Text, Number, Date, Dropdown, Textarea, Yes/No
- Apply to bookings or cheques
- Optional or required

## 📈 Data Analysis

### KPI Dashboard
- **Total Bookings**: Count of all bookings
- **Booking Value**: Sum of agreement values
- **Completion Rate**: % of agreements completed
- **Bank Distribution**: Bookings by bank

### Export Data
Download booking data as Excel with:
- All booking details
- Loan status summary
- Financial breakdown
- Custom fields

## 🔐 Security

### Database Security
- Row-level security (can be enabled)
- Service role functions with SECURITY DEFINER
- User authentication via Supabase Auth
- Password hashing with bcrypt

### Best Practices
1. Use strong passwords (12+ chars, mixed case, numbers)
2. Enable 2FA in Supabase
3. Restrict API keys by domain
4. Keep credentials in environment variables
5. Regular backups

## 🐛 Troubleshooting

### App Won't Load
- Check browser console (F12)
- Verify CSS/JS paths are correct
- Clear browser cache (Ctrl+Shift+Delete)
- Hard refresh (Ctrl+F5)

### Import Fails
- Ensure BWxSOTR sheet exists
- Check column mappings
- Verify client_name is mapped
- Look for special characters in data

### Users Can't Login
- Run `fix_login.sql` in Supabase
- Check user email in profiles table
- Verify user is confirmed in auth.users
- Check row-level security policies

### Data Not Showing
- Verify user has project assignment
- Check Supabase network requests (DevTools)
- Confirm database has data
- Try different project

## 📝 Excel File Format

### Expected Structure (Song of the River)
- Sheet name: "BWxSOTR"
- First row: Headers
- Data starts: Row 2
- Columns: 43 total (some skipped in import)

### Required Columns
- Column A: No (Serial)
- Column B: Date
- Column C: Name (Client)
- Column E: Plot No.

### Optional But Important
- Column F: Plot Size
- Column G: Basic Rate
- Column K: Agreement Value
- Column L: SDR
- Column R: Bank Name
- Column S: Loan Status

## 🚀 Deployment

### Local Development
```bash
# Using Python
python -m http.server 8000

# Using Node
npx http-server

# Using PHP
php -S localhost:8000
```

### Production Deployment
1. Use HTTPS only
2. Update CORS in Supabase
3. Set environment variables
4. Enable RLS policies
5. Configure backups
6. Setup monitoring

### Docker (Optional)
```dockerfile
FROM nginx:latest
COPY . /usr/share/nginx/html
EXPOSE 80
```

## 📚 API Reference

### Core Functions

#### User Management
```javascript
// Create user
await api('create', {
  email, password, name, role, project_id
});

// Update password
await api('update', {
  user_id, password
});

// Delete user
await api('delete', { user_id });
```

#### Data Operations
```javascript
// Import bookings
await sb.from('bookings').insert(rows);

// Update booking
await sb.from('bookings').update(data).eq('id', id);

// Get bookings
const { data } = await sb.from('bookings')
  .select('*')
  .eq('project_id', projId);
```

## 🤝 Contributing

### Report Issues
1. Check existing issues on GitHub
2. Provide error messages and steps to reproduce
3. Include browser/system info
4. Attach screenshots if helpful

### Suggest Features
1. Create discussion/issue
2. Describe use case
3. Provide user stories
4. Link relevant documentation

### Submit Changes
1. Fork repository
2. Create feature branch
3. Make changes with clear commits
4. Submit pull request
5. Include testing notes

## 📄 License

This project is proprietary software for Song of the River project.
All rights reserved.

## 📞 Support

For issues or questions:
1. Check this README
2. Review OPTIMIZATION_NOTES.md
3. Check browser console logs
4. Contact project lead

## 🎉 Version History

### v3.1 (Current)
- Optimized for Song of the River
- Smooth user/client workflows
- BWxSOTR focus
- Column type safety
- Better error handling

### v3.0
- Initial production release
- Basic CRM features
- Excel import support
- User management

### v2.0
- Beta release
- Core features

### v1.0
- Alpha release

---

**Status**: Production Ready ✅
**Last Updated**: 2026-03-20
**Optimized For**: Song of the River Real Estate Project
