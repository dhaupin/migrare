import Nav from "../components/Nav";
import Footer from "../components/Footer";
import EmailLinkIsland from "../components/EmailLinkIsland";

export default function Contact() {
  return (
    <div className="page">
      <Nav />
      <main className="content-page">
        <div className="page-container">
          <h1 className="page-title">Contact</h1>
          <p className="page-text">
            Have questions about migrare, the migration tool, or how to get your codebase 
            out of a locked-in platform? We'd love to hear from you.
          </p>
          <p className="page-text">
            Creadev can also handle the migration for you — from export to clean, portable code. 
            We specialize in extracting projects from Lovable, Bolt.new, and similar platforms, 
            then rebuilding them with proper architecture on your own infrastructure.
          </p>

          <h2 className="page-heading">What to include</h2>
          <p className="page-text">
            When you reach out, it'll help if you can share:
          </p>
          <ul className="page-list">
            <li>Where the project currently lives (Lovable, Bolt, Replit, etc.)</li>
            <li>Where you're planning to migrate it (Vercel, your own server, etc.)</li>
            <li>Whether it's currently live with user data we should account for</li>
            <li>Any specific features or integrations that have been tricky to move</li>
          </ul>

          <h2 className="page-heading">Email</h2>
          <p className="page-text">
            <EmailLinkIsland />
          </p>
          <p className="page-text t-dim">
            // no forms. no bots. just humans.
          </p>
          <p className="page-text t-dim">
            We typically respond within 24-48 hours.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
