import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./GithubIcon";
import useTheme from "../hooks/useTheme";

export default function ThemeToggleIsland() {
  const [mounted, setMounted] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className="nav-icon"
        aria-label="Toggle theme"
        id="theme-toggle"
        type="button"
        disabled
      >
        <SunIcon />
      </button>
    );
  }

  return (
    <button
      className="nav-icon"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      id="theme-toggle"
      type="button"
    >
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
