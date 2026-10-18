import { useEffect, useState } from 'react';
import {
  loadDock,
  saveDock,
  onDockChanged,
  toggleDockWidget,
  moveDockWidget,
  isDocked,
  dockItems,
  WIDGETS,
  DOCK_EDGES,
  DEFAULT_DOCK,
  TIERS,
} from '../core/dock.js';
import { Button, ToggleField, RadioField } from './fields.jsx';
import { Icon } from './Icon.jsx';

const EDGE_LABELS = { bottom: 'Bottom', left: 'Left', right: 'Right' };

/**
 * Which mini apps are in the dock, and in what order.
 *
 * Two lists rather than one with checkboxes: what is in the dock is ordered and
 * what is not has no order at all, and pretending otherwise makes the reorder
 * arrows meaningless on half the rows.
 *
 * The paid tools sit in the same catalogue as the free ones and can be docked
 * the same way. They are off by default - eight locked icons in front of
 * someone who has not subscribed is a shop window - but someone who pays for
 * them should be able to reach their invoices without leaving the job board,
 * which is the entire argument for a dock.
 */
export function DockSettings() {
  const [dock, setDock] = useState(null);

  useEffect(() => {
    loadDock().then(setDock);
    return onDockChanged(setDock);
  }, []);

  if (dock === null) return <p className="loading">Loading...</p>;

  const commit = (next) => saveDock(next).then(setDock);
  const docked = dockItems(dock);
  const available = WIDGETS.filter((widget) => !isDocked(dock, widget.id));

  return (
    <div className="dock-settings">
      <p className="section-desc">
        The dock is the bar of little apps over OnlineJobs.ph. Drag it by the handle on
        its end to move it to another edge; everything else about it is here.
      </p>

      <ToggleField
        label="Show the dock"
        hint="Off hides it everywhere. The tracker is still reachable from this settings page."
        checked={dock.enabled}
        onChange={(enabled) => commit({ enabled })}
      />
      <ToggleField
        label="Name the icons on hover"
        checked={dock.labels}
        onChange={(labels) => commit({ labels })}
      />
      <RadioField
        label="Edge"
        name="dock-edge"
        value={dock.edge}
        options={DOCK_EDGES.map((edge) => ({ value: edge, label: EDGE_LABELS[edge] }))}
        onChange={(edge) => commit({ edge })}
      />

      <h3 className="rules-examples-heading">In the dock</h3>
      {docked.length === 0 ? (
        <p className="field-hint">Nothing in the dock. Add something from the list below.</p>
      ) : (
        <ul className="dock-list">
          {docked.map((widget, index) => (
            <li key={widget.id} className="dock-row">
              <span className="dock-row-icon">
                <Icon name={widget.icon} size={20} />
              </span>
              <span className="dock-row-text">
                <strong>{widget.label}</strong>
                <span className="field-hint">{widget.hint}</span>
              </span>
              {widget.tier === TIERS.OPS ? (
                <span className="dock-row-tier">Subscription</span>
              ) : null}
              <button
                type="button"
                className="dock-move"
                aria-label={`Move ${widget.label} earlier`}
                disabled={index === 0}
                onClick={() => commit(moveDockWidget(dock, widget.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="dock-move"
                aria-label={`Move ${widget.label} later`}
                disabled={index === docked.length - 1}
                onClick={() => commit(moveDockWidget(dock, widget.id, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="dock-toggle"
                onClick={() => commit(toggleDockWidget(dock, widget.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <>
          <h3 className="rules-examples-heading">Not in the dock</h3>
          <ul className="dock-list">
            {available.map((widget) => (
              <li key={widget.id} className="dock-row is-off">
                <span className="dock-row-icon">
                  <Icon name={widget.icon} size={20} />
                </span>
                <span className="dock-row-text">
                  <strong>{widget.label}</strong>
                  <span className="field-hint">{widget.hint}</span>
                </span>
                {widget.tier === TIERS.OPS ? (
                  <span className="dock-row-tier">Subscription</span>
                ) : null}
                <button
                  type="button"
                  className="dock-toggle"
                  onClick={() => commit(toggleDockWidget(dock, widget.id))}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="rules-actions">
        <Button variant="ghost" size="sm" onClick={() => commit({ ...DEFAULT_DOCK })}>
          Reset the dock
        </Button>
      </div>
    </div>
  );
}
