import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/env.dart';
import 'api_client.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/auth_expired_interceptor.dart';

final cortexKeyProvider = StateProvider<String?>((ref) => null);

final apiClientProvider = Provider<ApiClient>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: Env.baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(minutes: 5),
    headers: {'Content-Type': 'application/json'},
  ));
  dio.interceptors.add(AuthInterceptor(ref));
  dio.interceptors.add(AuthExpiredInterceptor(ref));
  return ApiClient(dio);
});
