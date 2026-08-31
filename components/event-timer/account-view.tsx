"use client";

import { LogOut } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function AccountView({ session }: { session: Session }) {
  const logout = async () => {
    await supabase.auth.signOut();
    location.href = "/";
  };

  return (
    <section className="account-panel">
      <p className="eyebrow">ACCOUNT</p>
      <h1>Event Timer account</h1>
      <dl>
        <div>
          <dt>Email</dt>
          <dd>{session.user.email}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>Secure Supabase session · refresh enabled</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>Cloud beta</dd>
        </div>
      </dl>
      <button className="button secondary" onClick={() => void logout()}>
        <LogOut size={16} /> Log out
      </button>
    </section>
  );
}
