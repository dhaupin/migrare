import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Terms() {
  return (
    <div className="page">
      <Nav />
      <main className="main">
        <div className="doc-layout">
          <article className="doc-content">
            <h1>Terms of Service</h1>

            <p className="t-dim">
              By using migrare, you agree to these terms. If you don't agree, don't use this service.
            </p>

            <h2>1. No Warranty</h2>
            <p>
              migrare is provided "as is" without any warranty of any kind, express or implied. 
              We don't guarantee that the tool will work perfectly, or that your code won't have 
              issues after migration. Use at your own risk.
            </p>

            <h2>2. Not Responsible for Anything</h2>
            <p>
              We are not responsible for any loss, damage, or issues that arise from using this 
              tool. This includes but is not limited to: data loss, code breaking, migration 
              failures, or anything else that goes wrong.
            </p>

            <h2>3. We Don't Save Your Data</h2>
            <p>
              migrare processes your ZIP files in memory and doesn't store them anywhere. 
              We don't keep your code, your project files, or anything you upload. Once the 
              migration is done, it's gone.
            </p>

            <h2>4. Back Up Before You Migrate</h2>
            <p>
              Always back up your project before running migrare. Keep a copy of your original 
              code somewhere safe. We're not responsible if something goes wrong.
            </p>

            <h2>5. Review Before Merging</h2>
            <p>
              The output of migrare is a set of changed files. Review them carefully before 
              merging into your repository. Don't just blindly accept the changes.
            </p>

            <h2>6. Your Code, Your Responsibility</h2>
            <p>
              After migration, the resulting code is yours. You're responsible for making 
              sure it works, that it passes your tests, and that it meets your standards.
            </p>

            <h2>7. Don't Use This (Just Kidding)</h2>
            <p>
              Actually, do use migrare if it helps! But please understand the risks. 
              We're providing a helpful tool, but you're the one in control of your code.
            </p>

            <h2>8. Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. If we do, the new terms apply 
              automatically. Continuing to use the service means you accept the new terms.
            </p>

            <p className="t-muted t-sm" style={{ marginTop: "2rem" }}>
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}