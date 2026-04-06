import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/entity_data.dart';

final entitiesProvider = FutureProvider<List<GraphEntity>>((ref) {
  return ref.read(apiClientProvider).getEntities();
});

final entitySearchProvider =
    FutureProvider.family<List<GraphEntity>, String>((ref, query) {
  return ref.read(apiClientProvider).searchEntities(query);
});

final entityDetailProvider =
    FutureProvider.family<EntityDetail, int>((ref, id) {
  return ref.read(apiClientProvider).getEntityDetail(id);
});
