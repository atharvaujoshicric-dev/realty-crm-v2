// Supabase Edge Function — manage-users
// Handles create / delete / update-password using the service role key
// Deploy: supabase functions deploy manage-users

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Use service role key — this bypasses all auth restrictions
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the caller is authenticated and is superadmin or admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check caller has admin or superadmin role
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['superadmin', 'admin'].includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const { action } = body

    // ── CREATE USER ────────────────────────────────────────────
    if (action === 'create') {
      const { email, password, name, role, project_id, project_role } = body

      if (!email || !password || !name || !role) {
        return new Response(JSON.stringify({ error: 'email, password, name, role required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Create auth user using admin API — works 100% reliably
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name }
      })

      if (createErr) {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const uid = newUser.user.id

      // Insert profile
      const { error: profErr } = await supabaseAdmin
        .from('profiles').upsert({ id: uid, full_name: name, role })
      if (profErr) {
        return new Response(JSON.stringify({ error: 'User created but profile failed: ' + profErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Assign to project if provided
      if (project_id) {
        await supabaseAdmin.from('project_members').upsert({
          project_id, user_id: uid, role: project_role || role
        })
      }

      return new Response(JSON.stringify({ id: uid, email, name, role }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── DELETE USER ────────────────────────────────────────────
    if (action === 'delete') {
      const { user_id } = body
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'user_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Remove from project_members and profiles first
      await supabaseAdmin.from('project_members').delete().eq('user_id', user_id)
      await supabaseAdmin.from('profiles').delete().eq('id', user_id)

      // Delete from auth — admin API works reliably
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id)
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── UPDATE PASSWORD ────────────────────────────────────────
    if (action === 'update_password') {
      const { user_id, password } = body
      if (!user_id || !password) {
        return new Response(JSON.stringify({ error: 'user_id and password required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password })
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
