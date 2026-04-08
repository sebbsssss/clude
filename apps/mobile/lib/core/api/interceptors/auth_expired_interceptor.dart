import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_provider.dart';

class AuthExpiredInterceptor extends Interceptor {
  final Ref _ref;

  AuthExpiredInterceptor(this._ref);

  /// Only clear auth on 401 from Cortex-compatible endpoints.
  /// A 401 from other endpoints means wrong auth type, not expired key.
  static bool _isCortexEndpoint(String path) {
    return path.startsWith('/api/cortex') || path.startsWith('/api/chat');
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401) {
      final path = err.requestOptions.path;
      if (_isCortexEndpoint(path)) {
        final auth = _ref.read(authNotifierProvider);
        if (auth.isAuthenticated) {
          _ref.read(authNotifierProvider.notifier).clearAuth();
        }
      }
    }
    handler.next(err);
  }
}
