import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/settings/agents_provider.dart';
import '../api/models/agent.dart';
import '../storage/secure_storage_provider.dart';

final selectedAgentNotifierProvider =
    AsyncNotifierProvider<SelectedAgentNotifier, String?>(
  SelectedAgentNotifier.new,
);

class SelectedAgentNotifier extends AsyncNotifier<String?> {
  @override
  Future<String?> build() async {
    return ref.read(secureStorageProvider).getSelectedAgentId();
  }

  Future<void> selectAgent(String agentId) async {
    await ref.read(secureStorageProvider).setSelectedAgentId(agentId);
    state = AsyncValue.data(agentId);
    // Invalidate agent-scoped data so it re-fetches for the new agent.
    ref.invalidate(agentsProvider);
  }

  /// Auto-select the sole agent for single-agent users. No-op if already selected.
  Future<void> autoSelectIfSingle(List<Agent> agents) async {
    if (agents.length == 1 && state.valueOrNull == null) {
      await selectAgent(agents.first.id);
    }
  }

  Future<void> clear() async {
    await ref.read(secureStorageProvider).deleteSelectedAgentId();
    state = const AsyncValue.data(null);
  }
}
