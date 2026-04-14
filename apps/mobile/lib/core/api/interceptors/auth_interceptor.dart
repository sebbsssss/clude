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

    // BYOK headers passed via options.extra by ChatNotifier.send()
    final byokKey = options.extra['byokKey'] as String?;
    final byokProvider = options.extra['byokProvider'] as String?;
    if (byokKey != null && byokProvider != null) {
      options.headers['X-BYOK-Key'] = byokKey;
      options.headers['X-BYOK-Provider'] = byokProvider;
    }

    handler.next(options);
  }
}
