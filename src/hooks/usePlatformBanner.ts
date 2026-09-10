import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Platform-wide announcement banner text set by staff in Platform Settings. */
export function usePlatformBanner() {
  const [banner, setBanner] = useState("");

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("platform_config")
      .select("value")
      .eq("key", "announcement_banner")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const value = data?.value;
        setBanner(typeof value === "string" ? value : "");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return banner;
}
