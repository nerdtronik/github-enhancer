/**
 * Gear menu with toggles and choice settings for the run view. Controls write through
 * `settings.set`; their pressed state is mirrored back by the `sync*` methods, which index.ts
 * reaches through the toolbar from `settings.onChange`, so a change made elsewhere updates every
 * open toolbar.
 */
import { createIcon, settings } from "../../core/settings";
import { ui } from "../../core/ui";
import { createListeners, state } from "./shared";

type ChoiceKey = "actionRun_searchPosition" | "actionRun_arrowPlacement";

export interface SettingsPanel {
  element: HTMLElement;
  syncHover(): void;
  syncGrouping(): void;
  syncSearchPosition(): void;
  syncArrowPlacement(): void;
  dispose(): void;
}

const flip = (key: "actionRun_hoverFocusEnabled" | "actionRun_statusGroupingEnabled") =>
  void settings.set(key, !settings.get(key));

export function createSettingsPanel(): SettingsPanel {
  const { listen, dispose: removeListeners } = createListeners();

  const panel = document.createElement("details");
  panel.className = "gha-run-settings";
  const trigger = document.createElement("summary");
  trigger.className = "gha-run-settings-trigger";
  trigger.setAttribute("aria-label", "Job view settings");
  trigger.title = "Job view settings";
  trigger.append(createIcon("gear"));

  const menu = document.createElement("div");
  menu.className = "gha-run-settings-menu";

  const hoverSetting = ui.toggle({
    label: "Highlight related jobs on hover",
    labelId: `gha-run-hover-label-${++state.settingsToggleId}`,
    pressed: settings.get("actionRun_hoverFocusEnabled"),
    buttonClass: "gha-run-hover-toggle gha-run-setting-toggle",
    onChange: () => flip("actionRun_hoverFocusEnabled"),
  });

  const groupSetting = ui.toggle({
    label: "Group by status",
    labelId: `gha-run-group-label-${++state.settingsToggleId}`,
    pressed: settings.get("actionRun_statusGroupingEnabled"),
    buttonClass: "gha-run-group-toggle gha-run-setting-toggle",
    onChange: () => flip("actionRun_statusGroupingEnabled"),
  });

  // Choice buttons do not mark themselves pressed on click; `sync` does it after the setting
  // actually changes.
  const createChoiceSetting = (
    labelText: string,
    key: ChoiceKey,
    choices: [string, string][],
  ) => {
    const setting = document.createElement("div");
    setting.className = "gha-run-setting";
    const label = document.createElement("span");
    label.id = `gha-run-choice-label-${++state.settingsToggleId}`;
    label.textContent = labelText;

    const group = document.createElement("div");
    group.className = "gha-run-setting-choices";
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", label.id);

    const buttons = new Map<string, HTMLButtonElement>();
    for (const [value, name] of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.dataset.value = value;
      group.append(button);
      buttons.set(value, button);
      listen(button, "click", () => {
        void settings.set(key, value as never);
      });
    }
    setting.append(label, group);
    return {
      setting,
      sync() {
        for (const [value, button] of buttons)
          button.setAttribute("aria-pressed", String(settings.get(key) === value));
      },
    };
  };

  const searchSetting = createChoiceSetting(
    "Search and filter",
    "actionRun_searchPosition",
    [
      ["left", "Left"],
      ["right", "Right"],
    ],
  );
  const arrowSetting = createChoiceSetting(
    "Scroll arrows",
    "actionRun_arrowPlacement",
    [
      ["left", "Left"],
      ["right", "Right"],
      ["both", "Both"],
    ],
  );

  menu.append(
    hoverSetting.row,
    groupSetting.row,
    searchSetting.setting,
    arrowSetting.setting,
  );
  panel.append(trigger, menu);
  const disposeMenu = ui.detailsMenu(panel, { stopPropagation: true });

  return {
    element: panel,
    syncHover: () => hoverSetting.sync(settings.get("actionRun_hoverFocusEnabled")),
    syncGrouping: () => groupSetting.sync(settings.get("actionRun_statusGroupingEnabled")),
    syncSearchPosition: searchSetting.sync,
    syncArrowPlacement: arrowSetting.sync,
    dispose() {
      disposeMenu();
      removeListeners();
    },
  };
}
