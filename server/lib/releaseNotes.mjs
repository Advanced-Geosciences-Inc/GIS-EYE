/**
 * CHANGELOG-driven release notes.
 *
 * The release flow (docs/agi/RELEASING.md) cuts the `[Unreleased]` section of
 * CHANGELOG.md into a versioned heading and emits the same content as
 * structured notes: `release-notes.json` is baked into the image
 * (server/build-info.json) and served by `/api/version` for the in-app
 * update toast. scripts/release-notes.mjs is the CLI over this module.
 */

const UNRELEASED_HEADING = /^## \[Unreleased\][^\S\n]*$/m;
const NEXT_SECTION = /^## \[/m;

/** Extract the body of the [Unreleased] section (text between headings). */
export function extractUnreleased(changelog) {
  const match = UNRELEASED_HEADING.exec(changelog);
  if (!match) throw new Error('CHANGELOG.md has no ## [Unreleased] heading');
  const bodyStart = match.index + match[0].length;
  const rest = changelog.slice(bodyStart);
  const next = NEXT_SECTION.exec(rest);
  const bodyEnd = next ? bodyStart + next.index : changelog.length;
  return {
    body: changelog.slice(bodyStart, bodyEnd),
    start: bodyStart,
    end: bodyEnd,
  };
}

/**
 * Parse a section body into notes: bullets grouped under `### Added` /
 * `### Changed` / `### Fixed` / `### Security` subheadings; continuation
 * lines are folded into their bullet. Bullets before any subheading get
 * type 'note'.
 */
export function parseNotes(body) {
  const notes = [];
  let type = 'note';
  for (const line of body.split('\n')) {
    const heading = /^### +(.+?)\s*$/.exec(line);
    if (heading) {
      type = heading[1].trim().toLowerCase();
      continue;
    }
    const bullet = /^- +(.*)$/.exec(line);
    if (bullet) {
      notes.push({ type, text: bullet[1].trim() });
      continue;
    }
    const continuation = /^ {2,}(\S.*)$/.exec(line);
    if (continuation && notes.length) {
      notes[notes.length - 1].text += ` ${continuation[1].trim()}`;
    }
  }
  return notes;
}

/**
 * Move the [Unreleased] content under a new version heading, leaving an
 * empty [Unreleased] section, and return the notes that shipped.
 */
export function cutRelease(changelog, version, date) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`Not a semver version: ${version}`);
  }
  const { body, start, end } = extractUnreleased(changelog);
  const notes = parseNotes(body);
  if (!notes.length) throw new Error('The [Unreleased] section has no entries to release');
  const trimmed = body.replace(/^\n+/, '').replace(/\s+$/, '');
  const next = `\n\n## [${version}] — ${date}\n\n${trimmed}\n\n`;
  return {
    changelog: changelog.slice(0, start) + next + changelog.slice(end),
    notes,
  };
}
