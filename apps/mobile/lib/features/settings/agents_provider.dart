import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/agent.dart';

final agentsProvider = FutureProvider<List<Agent>>((ref) async {
  final client = ref.watch(apiClientProvider);
  return client.listAgents();
});
