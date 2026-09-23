import { Navigate } from "react-router-dom";
import { isAdmin } from "../hooks/useAuth";

interface Props { children: React.ReactNode; }

export default function AdminRoute({ children }: Props) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  if (!isAdmin()) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}