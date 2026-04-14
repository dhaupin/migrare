import { Link } from "react-router-dom";
import GithubIcon from "./GithubIcon";

export default function Footer() {
  return (
    <footer className="footer">
      <Link to="/app" className="footer-link">Migrate</Link>
      <span className="footer-sep">·</span>
      <Link to="/docs" className="footer-link">Docs</Link>
      <span className="footer-sep">·</span>
      <Link to="/for-ai" className="footer-link">For AI</Link>
      <span className="footer-sep">·</span>
      <a
        href="https://github.com/dhaupin/migrare"
        target="_blank"
        rel="noopener noreferrer"
        className="footer-link"
      >
        <GithubIcon />
        Source
      </a>
      <span className="footer-sep">·</span>
      <a
        href="https://github.com/dhaupin/migrare/blob/main/LICENSE"
        target="_blank"
        rel="noopener noreferrer"
        className="footer-link"
      >
        MIT license
      </a>
    </footer>
  );
}