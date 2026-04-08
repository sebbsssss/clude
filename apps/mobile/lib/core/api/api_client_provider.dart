import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/env.dart';
import '../auth/auth_provider.dart';
import 'api_client.dart';
import 'demo_api_client.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/auth_expired_interceptor.dart';

final cortexKeyProvider = Provider<String?>((ref) {
  return ref.watch(authNotifierProvider).cortexKey;
});

/// Set to true to use DemoApiClient with hardcoded data (no server needed).
/// To remove demo mode: delete this provider and the if-block below.
final demoModeProvider = StateProvider<bool>((ref) => false);

final apiClientProvider = Provider<ApiClient>((ref) {
  if (ref.watch(demoModeProvider)) {
    return DemoApiClient();
  }
  final dio = Dio(BaseOptions(
    baseUrl: Env.apiBaseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(minutes: 5),
    headers: {'Content-Type': 'application/json'},
  ));
  dio.interceptors.add(AuthInterceptor(ref));
  dio.interceptors.add(AuthExpiredInterceptor(ref));
  return ApiClient(dio);
});
