import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/selected_agent_provider.dart';
import 'agent_selector_sheet.dart';
import 'agents_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentsProvider);
    final selectedId = ref.watch(selectedAgentNotifierProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // Agent section — only shown for multi-agent users
          ...agentsAsync.when(
            loading: () => <Widget>[],
            error: (_, __) => <Widget>[],
            data: (agents) {
              if (agents.length <= 1) return <Widget>[];

              final selectedAgent = agents
                  .where((a) => a.id == selectedId)
                  .firstOrNull;

              return <Widget>[
                ListTile(
                  title: const Text('Agent'),
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
        ],
      ),
    );
  }
}
