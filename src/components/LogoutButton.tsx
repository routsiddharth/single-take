"use client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="act"
      style={{ borderRight: "none", paddingLeft: 0 }}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.refresh();
        router.push("/");
      }}
    >
      sign out ↩
    </button>
  );
}
