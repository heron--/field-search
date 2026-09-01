import * as React from "react";
import {
  defaultSuggestions,
  SearchInput,
  type FieldSuggestion,
  type SearchContext,
  type SuggestionItem,
} from "../src/react";
import { parse } from "../src/parser";
import { format } from "../src/format";
import { PRODUCE, type Produce } from "./data";
import { filterRecords } from "./evaluate";
import "../src/react/styles.css";
import "./playground.css";

/** Distinct values for a field, for the suggestion list. */
function distinct(pick: (row: Produce) => string | string[]): string[] {
  const seen = new Set<string>();
  for (const row of PRODUCE) {
    const got = pick(row);
    for (const v of Array.isArray(got) ? got : [got]) seen.add(v);
  }
  return [...seen].sort();
}

const FIELDS: FieldSuggestion[] = [
  { field: "name", detail: "text", values: distinct((r) => r.name) },
  { field: "kind", detail: "text", values: distinct((r) => r.kind) },
  { field: "colors", detail: "list", values: distinct((r) => r.colors) },
  { field: "origin", detail: "country · async" },
  { field: "tags", detail: "list", values: distinct((r) => r.tags) },
  { field: "calories", detail: "number" },
  { field: "grams", detail: "number" },
  { field: "price", detail: "number" },
  { field: "seeds", detail: "number" },
  { field: "harvested", detail: "date" },
];

const EXAMPLES: { label: string; query: string; note: string }[] = [
  { label: "Simple filter", query: "kind:fruit", note: "one field, one value" },
  {
    label: "Implicit AND",
    query: "kind:vegetable colors:green",
    note: "juxtaposition, no operator",
  },
  {
    label: "Explicit OR",
    query: "kind:fruit OR kind:nut",
    note: "a top-level boolean, not a value list",
  },
  {
    label: "Negation",
    query: "kind:fruit -colors:green",
    note: "- excludes a filter",
  },
  {
    label: "Wildcard",
    query: "name:*berry",
    note: "* matches any run of characters",
  },
  {
    label: "Quoted value",
    query: 'name:"granny smith"',
    note: "quotes hold a space",
  },
  {
    label: "Comparison",
    query: "calories:>100 price:<3.00",
    note: "numeric operators",
  },
  {
    label: "Range",
    query: "calories:[50 TO 100]",
    note: "inclusive bounds in this example",
  },
  {
    label: "Value OR",
    query: "colors:(red OR yellow)",
    note: "booleans inside one field",
  },
  {
    label: "Value AND",
    query: "colors:(green AND red)",
    note: "a list field holding both",
  },
  {
    label: "Value negation",
    query: "kind:fruit colors:(-green)",
    note: "- needs a group in a value",
  },
  {
    label: "Precedence",
    query: "(kind:nut OR kind:legume) price:<8.00",
    note: "group overrides binding",
  },
  {
    label: "Datetime",
    query: "harvested:>@2024-06-01",
    note: "@ marks a date literal",
  },
  {
    label: "Date range",
    query: "harvested:[@2024-01-01 TO @2024-06-30]",
    note: "ranges take dates too",
  },
  {
    label: "Bare term",
    query: "tropical",
    note: "no field: matches anywhere",
  },
];

type Skin = "default" | "midnight" | "custom";

const SKINS: { id: Skin; label: string; note: string }[] = [
  { id: "default", label: "Default", note: "styles.css as shipped" },
  { id: "midnight", label: "Midnight", note: "token overrides only" },
  {
    id: "custom",
    label: "Custom",
    note: "consumer classes override the theme",
  },
];

const ASYNC_DELAY = 450;

const ASYNC_ORIGINS = PRODUCE.map((row) => ({
  produce: row.name,
  country: row.origin,
}));

const ASYNC_COUNTRIES = [
  ...new Set(ASYNC_ORIGINS.map((row) => row.country)),
].sort();

function loadOriginSuggestions(
  context: SearchContext,
  signal: AbortSignal,
): Promise<SuggestionItem[]> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      resolve(
        defaultSuggestions(
          [{ field: "origin", detail: "country", values: ASYNC_COUNTRIES }],
          context.target,
        ),
      );
    }, ASYNC_DELAY);

    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Suggestion request aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export default function App() {
  const initialQuery = "kind:fruit -colors:green";
  const [query, setQuery] = React.useState(initialQuery);
  const [context, setContext] = React.useState<SearchContext | null>(null);
  const [searched, setSearched] = React.useState(initialQuery);
  const [skin, setSkin] = React.useState<Skin>("default");
  const [suggestions, setSuggestions] = React.useState<SuggestionItem[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = React.useState(false);

  /**
   * Synchronous suggestions settle in the same batch as the context they came
   * from. Deriving them in an effect instead would add a render to every
   * keystroke, and those chained renders accumulate against React's nested
   * update limit while someone is typing quickly.
   */
  const handleContextChange = React.useCallback((next: SearchContext) => {
    setContext(next);
    const target = next.target;
    if (target.kind === "value" && target.field === "origin") return;
    setSuggestionsLoading(false);
    setSuggestions(defaultSuggestions(FIELDS, target));
  }, []);

  // Only the asynchronous source needs an effect, so only it pays for one.
  React.useEffect(() => {
    if (!context) return;

    const target = context.target;
    if (!(target.kind === "value" && target.field === "origin")) return;

    const request = new AbortController();
    setSuggestionsLoading(true);

    loadOriginSuggestions(context, request.signal)
      .then(setSuggestions)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error(error);
        }
      })
      .finally(() => {
        if (!request.signal.aborted) setSuggestionsLoading(false);
      });

    return () => request.abort();
  }, [context?.target.kind, context?.target.field, context?.target.fragment]);

  const results = React.useMemo(() => {
    if (searched.trim() === "") return PRODUCE;
    try {
      return filterRecords(parse(searched), PRODUCE);
    } catch {
      return null;
    }
  }, [searched]);

  const roundTrip = React.useMemo(() => {
    if (query.trim() === "") return "";
    try {
      return format(parse(query));
    } catch (e) {
      return (e as Error).message;
    }
  }, [query]);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>field-search</h1>
          <p>
            Type a query. Chips are derived from the string itself — the input
            is controlled by <code>value</code>, while results follow the last
            valid search commit.
          </p>
        </div>
        <div className="pg-skins">
          {SKINS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="pg-skin"
              data-active={option.id === skin || undefined}
              onClick={() => setSkin(option.id)}
              title={option.note}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className={`pg-search${skin === "midnight" ? " pg-midnight" : ""}`}>
        <div className="pg-search-label">
          <label htmlFor="produce-search">Search produce</label>
          <span>{SKINS.find((s) => s.id === skin)?.note}</span>
        </div>
        <SearchInput
          id="produce-search"
          value={query}
          onValueChange={setQuery}
          onContextChange={handleContextChange}
          onSearch={(next) => setSearched(next)}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          loadingMessage="Loading countries from mock API…"
          emptyMessage="No matches"
          suggestionsHeader={(current) =>
            current.target.kind === "value" && current.target.field === "origin"
              ? "Countries from the async source"
              : "Filter by"
          }
          placeholder="kind:fruit -colors:green"
          classNames={
            skin === "custom"
              ? { field: "pg-bare-field", chip: "pg-bare-chip" }
              : undefined
          }
        />
      </div>

      <section className="pg-examples" aria-label="Example queries">
        {EXAMPLES.map((example) => (
          <button
            key={example.query}
            type="button"
            className="pg-example"
            onClick={() => {
              setQuery(example.query);
              setSearched(example.query);
            }}
            title={example.note}
          >
            <span className="pg-example-label">{example.label}</span>
            <code>{example.query}</code>
          </button>
        ))}
      </section>

      <div className="pg-body">
        <section className="pg-results">
          <h2 className="pg-results-head">
            {results === null
              ? "Committed query is invalid"
              : `${results.length} of ${PRODUCE.length}${
                  context && !context.valid ? " · showing previous search" : ""
                }`}
          </h2>
          {results !== null && (
            <div className="pg-table-scroll">
              <table className="pg-table">
                <thead>
                  <tr>
                    <th>name</th>
                    <th>kind</th>
                    <th>colors</th>
                    <th>origin</th>
                    <th className="pg-num">calories</th>
                    <th className="pg-num">price</th>
                    <th className="pg-num">seeds</th>
                    <th>harvested</th>
                    <th>tags</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.kind}</td>
                      <td>{row.colors.join(", ")}</td>
                      <td>{row.origin}</td>
                      <td className="pg-num">{row.calories}</td>
                      <td className="pg-num">{row.price.toFixed(2)}</td>
                      <td className="pg-num">{row.seeds}</td>
                      <td>{row.harvested}</td>
                      <td>{row.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="pg-side">
          <div className="pg-panel">
            <h2>Caret context</h2>
            <dl>
              <dt>target</dt>
              <dd>{context?.target.kind ?? "field"}</dd>
              <dt>field</dt>
              <dd>{context?.target.field ?? "—"}</dd>
              <dt>fragment</dt>
              <dd>{context?.target.fragment || "—"}</dd>
              <dt>parses</dt>
              <dd>{context ? (context.ast ? "yes" : "no") : "—"}</dd>
              <dt>valid</dt>
              <dd>{context ? (context.valid ? "yes" : "no") : "—"}</dd>
            </dl>
            <p className="pg-note">
              This is what <code>onContextChange</code> hands you, so a caller
              knows which options to fetch.
            </p>
          </div>

          <div className="pg-panel">
            <h2>Round trip</h2>
            <code className="pg-roundtrip">{roundTrip || "—"}</code>
            <p className="pg-note pg-committed">
              Committed query: <code>{searched || "(all records)"}</code>
            </p>
          </div>

          <div className="pg-panel pg-async-source">
            <div className="pg-section-head">
              <h2>Async country source</h2>
              <span className="pg-api-badge">{ASYNC_ORIGINS.length} rows</span>
            </div>
            <p className="pg-note">
              Loaded for <code>origin</code> after a simulated {ASYNC_DELAY} ms
              request. Try <code>origin:aus</code>, accept Australia, and commit
              to filter the results.
            </p>
            <div className="pg-source-scroll">
              <table className="pg-source-table">
                <thead>
                  <tr>
                    <th>produce</th>
                    <th>country</th>
                  </tr>
                </thead>
                <tbody>
                  {ASYNC_ORIGINS.map((row) => (
                    <tr key={row.produce}>
                      <td>{row.produce}</td>
                      <td>{row.country}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
