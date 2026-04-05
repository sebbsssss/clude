import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_provider.dart';
import '../../core/auth/selected_agent_provider.dart';
import 'agent_selector_sheet.dart';
import 'agents_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentsProvider);
    final selectedId = ref.watch(selectedAgentNotifierProvider).valueOrNull;
    final authState = ref.watch(authNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Masked API key display: show last 4 chars if available.
    String maskedKey = '—';
    if (authState.cortexKey != null && authState.cortexKey!.length > 4) {
      maskedKey =
          'clk_••••••••${authState.cortexKey!.substring(authState.cortexKey!.length - 4)}';
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
        children: [
          // ── Account section ──────────────────────────────────────────────
          _SectionHeader(label: 'Account'),
          ListTile(
            title: const Text('API Key'),
            subtitle: Text(
              maskedKey,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            ),
            trailing: authState.cortexKey != null
                ? IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    onPressed: () =>
                        copyToClipboard(authState.cortexKey!, 'API key'),
                  )
                : null,
          ),
          ListTile(
            title: const Text('Wallet'),
            subtitle: Text(
              truncatedWallet,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            ),
            trailing: authState.walletAddress != null
                ? IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    onPressed: () =>
                        copyToClipboard(authState.walletAddress!, 'Wallet address'),
                  )
                : null,
          ),
          const Divider(),

          // ── Billing section ──────────────────────────────────────────────
          _SectionHeader(label: 'Billing'),
          ListTile(
            title: const Text('Top Up Balance'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/topup'),
          ),
          ListTile(
            title: const Text('Usage History'),
            trailing: const Icon(Icons.chevron_right),
            // spec 020 not yet implemented — no navigation
            onTap: null,
          ),
          const Divider(),

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
                ListTile(
                  title: const Text('Active Agent'),
                  subtitle: Text(selectedAgent?.name ?? 'Not selected'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    showModalBottomSheet(
                      context: context,
                      builder: (_) => const AgentSelectorSheet(),
                    );
                  },
                ),
                const Divider(),
              ];
            },
          ),

          // ── App section ───────────────────────────────────────────────────
          _SectionHeader(label: 'App'),
          const ListTile(
            title: Text('Version'),
            trailing: Text(
              '1.0.0 (build 1)',
              style: TextStyle(fontSize: 13),
            ),
          ),
          const Divider(),

          // ── Logout button ─────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: colorScheme.error,
                foregroundColor: colorScheme.onError,
              ),
              onPressed: () async {
                await ref.read(authNotifierProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              },
              child: const Text('Log Out'),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.onSurface.withAlpha(120),
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}
