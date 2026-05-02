import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/auth/auth_provider.dart';
import '../../core/auth/selected_agent_provider.dart';
import '../byok/byok_provider.dart';
import 'agent_selector_sheet.dart';
import 'agents_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentsProvider);
    final selectedId = ref.watch(selectedAgentNotifierProvider).valueOrNull;
    final authState = ref.watch(authNotifierProvider);
    final byokKeys = ref.watch(byokKeysNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Masked API key display: show last 4 chars if available.
    String maskedKey = '—';
    if (authState.cortexKey != null && authState.cortexKey!.length > 4) {
      maskedKey =
          'clk_••••••••••••${authState.cortexKey!.substring(authState.cortexKey!.length - 4)}';
    }

    // Truncated wallet address display.
    String truncatedWallet = '—';
    if (authState.walletAddress != null &&
        authState.walletAddress!.length > 8) {
      final w = authState.walletAddress!;
      truncatedWallet = '${w.substring(0, 4)}...${w.substring(w.length - 4)}';
    }

    void copyToClipboard(String text, String label) {
      Clipboard.setData(ClipboardData(text: text));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$label copied')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          // ── Account section ──────────────────────────────────────────────
          _SectionHeader(label: 'Account'),
          _CardGroup(
            children: [
              ListTile(
                title: const Text('API Key'),
                subtitle: Text(
                  maskedKey,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                ),
                trailing: authState.cortexKey != null
                    ? IconButton(
                        icon: Icon(Icons.copy, size: 18, color: colorScheme.onSurface.withAlpha(120)),
                        onPressed: () =>
                            copyToClipboard(authState.cortexKey!, 'API key'),
                      )
                    : null,
              ),
              Divider(height: 1, color: colorScheme.outline),
              ListTile(
                title: const Text('Wallet'),
                subtitle: Text(
                  truncatedWallet,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                ),
                trailing: authState.walletAddress != null
                    ? IconButton(
                        icon: Icon(Icons.copy, size: 18, color: colorScheme.onSurface.withAlpha(120)),
                        onPressed: () =>
                            copyToClipboard(authState.walletAddress!, 'Wallet address'),
                      )
                    : null,
              ),
            ],
          ),
          ListTile(
            title: const Text('API Keys (BYOK)'),
            subtitle: Text(
              '${byokKeys.length} of ${byokProviders.length} providers',
              style: const TextStyle(fontSize: 12),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/settings/byok'),
          ),

          // ── Billing section ──────────────────────────────────────────────
          _SectionHeader(label: 'Billing'),
          _CardGroup(
            children: [
              ListTile(
                title: const Text('Top Up Balance'),
                trailing: Icon(Icons.chevron_right, color: colorScheme.onSurface.withAlpha(100)),
                onTap: () => context.push('/topup'),
              ),
              Divider(height: 1, color: colorScheme.outline),
              ListTile(
                title: const Text('Usage History'),
                trailing: Icon(Icons.chevron_right, color: colorScheme.onSurface.withAlpha(100)),
                onTap: () => context.push('/settings/history'),
              ),
            ],
          ),

          // ── Agent section — only shown for multi-agent users ─────────────
          ...agentsAsync.when(
            loading: () => <Widget>[],
            error: (_, __) => <Widget>[],
            data: (agents) {
              if (agents.length <= 1) return <Widget>[];

              final selectedAgent =
                  agents.where((a) => a.id == selectedId).firstOrNull;

              return <Widget>[
                _SectionHeader(label: 'Agent'),
                _CardGroup(
                  children: [
                    ListTile(
                      title: const Text('Active Agent'),
                      subtitle: Text(selectedAgent?.name ?? 'Not selected'),
                      trailing: Icon(Icons.chevron_right, color: colorScheme.onSurface.withAlpha(100)),
                      onTap: () {
                        showModalBottomSheet(
                          context: context,
                          builder: (_) => const AgentSelectorSheet(),
                        );
                      },
                    ),
                  ],
                ),
              ];
            },
          ),

          // ── Legal section ──────────────────────────────────────────────────
          _SectionHeader(label: 'Legal'),
          _CardGroup(
            children: [
              ListTile(
                title: const Text('Privacy Policy'),
                trailing: Icon(Icons.open_in_new, size: 16, color: colorScheme.onSurface.withAlpha(100)),
                onTap: () => launchUrl(Uri.parse('https://clude.io/privacy'), mode: LaunchMode.externalApplication),
              ),
              Divider(height: 1, color: colorScheme.outline),
              ListTile(
                title: const Text('Terms of Service'),
                trailing: Icon(Icons.open_in_new, size: 16, color: colorScheme.onSurface.withAlpha(100)),
                onTap: () => launchUrl(Uri.parse('https://clude.io/terms'), mode: LaunchMode.externalApplication),
              ),
            ],
          ),

          // ── App section ───────────────────────────────────────────────────
          _SectionHeader(label: 'App'),
          _CardGroup(
            children: [
              const ListTile(
                title: Text('Version'),
                subtitle: Text(
                  '1.0.0 (build 1)',
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),

          // ── Logout button ─────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: colorScheme.error,
                side: BorderSide(color: colorScheme.error),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              icon: const Icon(Icons.logout, size: 18),
              label: const Text('Log Out'),
              onPressed: () async {
                await ref.read(authNotifierProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              },
            ),
          ),

          // ── Delete Account ────────────────────────────────────────────────
          if (authState.isAuthenticated)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: TextButton.icon(
                style: TextButton.styleFrom(
                  foregroundColor: colorScheme.error.withAlpha(180),
                ),
                icon: const Icon(Icons.delete_forever, size: 18),
                label: const Text('Delete Account'),
                onPressed: () => _showDeleteAccountDialog(context, ref),
              ),
            ),
        ],
      ),
    );
  }
}

void _showDeleteAccountDialog(BuildContext context, WidgetRef ref) {
  final colorScheme = Theme.of(context).colorScheme;
  showDialog(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => Consumer(
      builder: (ctx, dialogRef, _) {
        final isDeleting = dialogRef.watch(
          authNotifierProvider.select((s) => s.isDeleting),
        );
        return AlertDialog(
          title: const Text('Delete Account'),
          content: Text(
            isDeleting
                ? 'Deleting your account…'
                : 'This will permanently delete your account and all associated data. This action cannot be undone.',
          ),
          actions: [
            TextButton(
              onPressed: isDeleting ? null : () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: colorScheme.error),
              onPressed: isDeleting
                  ? null
                  : () async {
                      final notifier =
                          ref.read(authNotifierProvider.notifier);
                      final ok = await notifier.deleteAccount();
                      if (!ctx.mounted) return;
                      // Pop while state is still isDeleting=true so the dialog
                      // doesn't visually flicker back to its initial state
                      // when logout() resets AuthState below.
                      Navigator.of(ctx).pop();
                      if (!context.mounted) return;
                      if (ok) {
                        await notifier.logout();
                        if (!context.mounted) return;
                        context.go('/login');
                      } else {
                        final err = ref.read(authNotifierProvider).error ??
                            'Could not delete account.';
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(err)),
                        );
                      }
                    },
              child: isDeleting
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Delete Account'),
            ),
          ],
        );
      },
    ),
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.onSurface.withAlpha(100),
          letterSpacing: 1.5,
        ),
      ),
    );
  }
}

class _CardGroup extends StatelessWidget {
  const _CardGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withAlpha(60),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }
}
