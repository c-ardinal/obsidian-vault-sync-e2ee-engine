import type {
    AddonAction,
    AddonSettingItem,
    AddonUiContributions,
    AddonUiHost,
    E2EEPluginContext,
    ICryptoEngine,
} from "../interfaces";

/**
 * This add-on's page under Vault-Sync's Settings › Add-ons, and its actions.
 *
 * The action ids are the command ids of earlier releases, so hotkeys users
 * bound to them keep working. Every action is also on the command palette.
 * The page shows only the actions that apply to the current state (set up,
 * locked or unlocked).
 */
export function buildUiContributions(
    engine: ICryptoEngine,
    ctx: E2EEPluginContext,
    _host: AddonUiHost,
): AddonUiContributions {
    const t = (key: string) => ctx.t(key);
    const enabled = () => ctx.settings.e2eeEnabled;
    const unlocked = () => engine.isUnlocked();

    const actions: AddonAction[] = [
        {
            id: "e2ee-setup",
            label: t("labelE2EESetup"),
            description: t("e2eeActionSetupDesc"),
            buttonText: t("e2eeActionSetupButton"),
            style: "cta",
            isAvailable: () => !enabled(),
            run: () => engine.showSetupModal(ctx),
        },
        {
            id: "e2ee-unlock",
            label: t("labelE2EEUnlock"),
            description: t("e2eeActionUnlockDesc"),
            buttonText: t("e2eeActionUnlockButton"),
            style: "cta",
            isAvailable: () => enabled() && !unlocked(),
            run: () => engine.showUnlockModal(ctx),
        },
        {
            id: "e2ee-change-password",
            label: t("labelE2EEChangePassword"),
            description: t("e2eeActionChangePasswordDesc"),
            buttonText: t("e2eeActionChangePasswordButton"),
            isAvailable: () => unlocked(),
            run: () => engine.showPasswordChangeModal(ctx),
        },
        {
            id: "e2ee-show-recovery",
            label: t("labelE2EEShowRecovery"),
            description: t("e2eeActionShowRecoveryDesc"),
            buttonText: t("e2eeActionShowRecoveryButton"),
            isAvailable: () => unlocked(),
            run: () => engine.showRecoveryExportModal(ctx),
        },
        {
            id: "e2ee-recover",
            label: t("labelE2EERecover"),
            description: t("e2eeActionRecoverDesc"),
            buttonText: t("e2eeActionRecoverButton"),
            isAvailable: () => enabled() && !unlocked(),
            run: () => engine.showRecoveryImportModal(ctx),
        },
    ];

    /** Row names on the page are shorter than the command names ("E2EE: ..."). */
    const rowLabels: Record<string, string> = {
        "e2ee-setup": t("e2eeActionSetupName"),
        "e2ee-unlock": t("e2eeActionUnlockName"),
        "e2ee-change-password": t("e2eeActionChangePasswordName"),
        "e2ee-show-recovery": t("e2eeActionShowRecoveryName"),
        "e2ee-recover": t("e2eeActionRecoverName"),
    };
    const actionRow = (id: string): AddonSettingItem => ({
        key: `_action_${id}`,
        type: "action",
        label: rowLabels[id],
        actionId: id,
    });

    return {
        actions,
        pages: [
            {
                id: "main",
                title: t("settingSecuritySection"),
                description: t("e2eePageDesc"),
                icon: "lock",
                getSections: () => [
                    {
                        id: "e2ee",
                        title: "",
                        items: [
                            {
                                key: "_subheader_e2ee_status",
                                type: "subheader",
                                label: t("settingSubheaderE2EEStatus"),
                            },
                            {
                                key: "e2eeStatusDisp",
                                type: "info",
                                label: t("settingE2EEStatus"),
                                getDesc: () => {
                                    if (!enabled()) return t("settingE2EEStatusDisabled");
                                    return unlocked()
                                        ? t("settingE2EEStatusUnlocked")
                                        : t("settingE2EEStatusLocked");
                                },
                            },
                            actionRow("e2ee-setup"),
                            actionRow("e2ee-unlock"),
                            {
                                key: "_subheader_e2ee_password",
                                type: "subheader",
                                label: t("e2eeSubheaderPassword"),
                                isHidden: () => !enabled(),
                            },
                            actionRow("e2ee-change-password"),
                            actionRow("e2ee-show-recovery"),
                            actionRow("e2ee-recover"),
                            {
                                key: "e2eeAutoUnlock",
                                type: "toggle",
                                label: t("settingE2EEAutoUnlock"),
                                desc: t("settingE2EEAutoUnlockDesc"),
                                isHidden: () => !enabled(),
                            },
                        ],
                    },
                ],
            },
        ],
    };
}
