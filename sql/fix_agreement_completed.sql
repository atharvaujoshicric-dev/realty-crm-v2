-- ================================================================
--  Fix: Agreement Completed bookings not showing correctly
--  Run in Supabase SQL Editor
-- ================================================================

-- 1. Fix loan_status for any bookings that have disbursement_status='done'
--    but wrong loan_status (they should be 'Agreement Completed')
--    These are the 8 customers from SOTR where col18='done'
UPDATE public.bookings
SET loan_status = 'Agreement Completed'
WHERE disbursement_status = 'done'
  AND loan_status NOT IN ('Agreement Completed', 'Cancelled');

-- 2. Show the fixed bookings
SELECT client_name, plot_no, loan_status, disbursement_status, bank_name
FROM public.bookings
WHERE loan_status = 'Agreement Completed'
ORDER BY client_name;

-- 3. Summary count
SELECT loan_status, COUNT(*) as count
FROM public.bookings
GROUP BY loan_status
ORDER BY count DESC;
