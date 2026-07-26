import { missingConfigKeys } from "./lib/config";

/**
 * Shown instead of the app when the build has no Supabase connection details.
 *
 * This exists because the alternative is what TestFlight users actually got: a
 * black screen with nothing on it. A build that can't possibly work should say
 * so, and say which build it is, so the next person doesn't have to guess.
 */
export default function ConfigError() {
  const missing = missingConfigKeys();

  return (
    <div className="config-error">
      <div>
        <h1>Wavo can't start</h1>
        <p>
          This build was compiled without its database connection details, so
          there's nothing for it to talk to. It isn't something you can fix from
          the app — the build itself needs redoing.
        </p>
        <p className="config-error-missing">
          Missing at build time:
          <br />
          {missing.map((k) => (
            <code key={k}>{k}</code>
          ))}
        </p>
        <p className="config-error-hint">
          If you're testing a TestFlight build, let Jake know and install the
          next one. The website at wavo.lol is unaffected.
        </p>
      </div>
    </div>
  );
}
