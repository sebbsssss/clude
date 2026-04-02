import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/selected_agent_provider.dart';
import 'agents_provider.dart';

class AgentSelectorSheet extends ConsumerWidget {
  const AgentSelectorSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentsProvider);
    final selectedId = ref.watch(selectedAgentNotifierProvider).valueOrNull;

    return agentsAsync.when(
      loading: () => const SizedBox(
        height: 200,
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => SizedBox(
        height: 200,
        child: Center(child: Text('Failed to load agents: $e')),
      ),
      data: (agents) => ListView.builder(
        shrinkWrap: true,
        itemCount: agents.length,
        itemBuilder: (context, index) {
          final agent = agents[index];
          final isSelected = agent.id == selectedId;

          final truncatedId = agent.id.length > 20
              ? '${agent.id.substring(0, 20)}...'
              : agent.id;

          return ListTile(
            title: Text(agent.name),
            subtitle: Text(
              '$truncatedId · ${agent.createdAt.split('T').first}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            trailing: isSelected
                ? Icon(Icons.check, color: Theme.of(context).colorScheme.primary)
                : null,
            onTap: () async {
              await ref
                  .read(selectedAgentNotifierProvider.notifier)
                  .selectAgent(agent.id);
              if (context.mounted) Navigator.pop(context);
            },
          );
        },
      ),
    );
  }
}
