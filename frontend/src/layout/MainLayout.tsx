import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import "../../src/tokens.css";

export default function MainLayout() {
  return (
    <div style={{
      display: "flex",
      height: "100vh",
      overflow: "hidden",
      fontFamily: "var(--font-sans)",
      background: "var(--gray-50)",
    }}>
      <Sidebar />
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
