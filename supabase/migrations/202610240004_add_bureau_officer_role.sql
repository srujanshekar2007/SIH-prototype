-- Allow authorized staff from other Bureaus, Cells, and Regional Offices to use the scoped officer dashboard.
alter type public.app_role add value if not exists 'bureau_officer';
