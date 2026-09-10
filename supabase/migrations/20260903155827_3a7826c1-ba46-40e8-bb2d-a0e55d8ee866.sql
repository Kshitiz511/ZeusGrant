
REVOKE EXECUTE ON FUNCTION public.billing_cycle_start(uuid, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.my_billing_cycle_start(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.consume_proposal_draft(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.billing_cycle_start(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_billing_cycle_start(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_proposal_draft(text) TO authenticated, service_role;
