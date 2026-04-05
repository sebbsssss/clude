import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/graph_data.dart';

final graphProvider = FutureProvider<GraphData>((ref) {
  return ref.read(apiClientProvider).getMemoryGraph(limit: 200);
});
