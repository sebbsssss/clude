import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/selected_agent_provider.dart';
import '../api_client_provider.dart';

class AuthInterceptor extends Interceptor {
  final Ref _ref;

  AuthInterceptor(this._ref);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (options.extra['skipAuth'] == true) {
      handler.next(options);
      return;
    }

    final key = _ref.read(cortexKeyProvider);
    if (key != null) {
      options.headers['Authorization'] = 'Bearer $key';
    }

    final agentId = _ref.read(selectedAgentNotifierProvider).valueOrNull;
    if (agentId != null) {
      options.queryParameters['agent_id'] = agentId;
    }

    handler.next(options);
  }
}
