import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Terms() {
  return (
    <div className="content-page">
      <Nav />
      <div className="page-container">
        <h1 className="page-title">Terms of Service</h1>
        <p className="page-text">
          By using migrare, you agree to these terms.
        </p>
        <h2 className="page-heading">Use of Service</h2>
        <p className="page-text">
          migrare is provided as-is for migrating your own projects. You are responsible for backing up your data before using the migration tool.
        </p>
        <h2 className="page-heading">Limitation of Liability</h2>
        <p className="page-text">
          migrare is not responsible for any data loss or damage resulting from the use of this tool. You use it at your own risk.
        </p>
        <p className="page-text t-dim">
          Last updated: April 2026
        </p>
      </div>
      <Footer />
    </div>
  );
}
