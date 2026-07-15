import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";

export default function LogoutButton({ className = "", buttonClassName = "" }) {
  const { user, logout } = useAuth();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {user?.full_name && (
        <span className="text-xs opacity-70 hidden sm:inline">{user.full_name}</span>
      )}
      <Button
        variant="ghost"
        onClick={logout}
        className={`gap-1.5 h-10 px-4 rounded-xl border ${buttonClassName}`}
        title="התנתקות"
      >
        <LogOut className="w-4 h-4" />
        התנתקות
      </Button>
    </div>
  );
}
