/** Honest CSS scenes for non-live lot states — building (slot mid-spin),
 *  failed (tombstone), blocked (rubber seal). Pure presentational. */

export function BuildingVignette() {
  return (
    <div className="vg-building">
      <div className="slotbox">
        <div className="slotreel">
          <div className="strip">
            7<br />$<br />3<br />%<br />0<br />7
          </div>
        </div>
        <div className="slotreel">
          <div className="strip">
            A<br />?<br />Z<br />#<br />K<br />A
          </div>
        </div>
        <div className="slotreel">
          <div className="strip">
            !<br />4<br />&amp;<br />9<br />X<br />!
          </div>
        </div>
        <div className="slot-lbl">rendering…</div>
      </div>
    </div>
  );
}

export function TombVignette({
  rip = "untitled artifact",
  epitaph = "the model fumbled it",
  born,
}: {
  rip?: string;
  epitaph?: string;
  born?: string;
}) {
  return (
    <div className="vg-tomb">
      <div className="tombstone">
        <div className="tomb-rip">R.I.P.</div>
        <div className="tomb-line">
          {rip}
          {born ? (
            <>
              <br />
              {born}
            </>
          ) : null}
        </div>
        <div className="tomb-epitaph">“{epitaph}”</div>
      </div>
    </div>
  );
}

export function BlockedVignette() {
  return (
    <div className="vg-blocked">
      <div className="seal">⊘</div>
      <div className="cap">blocked · the shot still counted</div>
    </div>
  );
}
