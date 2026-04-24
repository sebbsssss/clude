import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/auth/auth_provider.dart';
import '../../core/deep_link_service.dart';
import '../../core/router.dart';
import 'widgets/api_key_input.dart';
import 'widgets/wallet_connect_button.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _apiKeyController = TextEditingController();
  final _emailController = TextEditingController();
  bool _showApiKey = false;

  @override
  void initState() {
    super.initState();
    _emailController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _apiKeyController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _signInWithApiKey() async {
    final authState = ref.read(authNotifierProvider);
    if (authState.isLoading) return;

    final notifier = ref.read(authNotifierProvider.notifier);
    final success = await notifier.loginWithApiKey(
      _apiKeyController.text.trim(),
    );
    if (success && mounted) {
      final deepLinks = ref.read(deepLinkServiceProvider);
      final router = ref.read(routerProvider);
      if (deepLinks.pendingRoute != null) {
        deepLinks.consumePendingRoute(router);
      } else {
        context.go('/chat');
      }
    }
  }

  static final _emailRegex = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  bool _isValidEmail(String value) => _emailRegex.hasMatch(value.trim());

  Future<void> _submitEmail() async {
    final email = _emailController.text.trim();
    if (!_isValidEmail(email)) return;

    final notifier = ref.read(authNotifierProvider.notifier);
    final sent = await notifier.sendEmailCode(email);
    if (sent && mounted) {
      _showOtpSheet(email);
    }
  }

  Future<void> _showOtpSheet(String email) async {
    final success = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _OtpVerifySheet(ref: ref, email: email),
    );
    if (success == true && mounted) {
      context.go('/chat');
    }
  }

  void _continueAsGuest() {
    ref.read(authNotifierProvider.notifier).continueAsGuest();
    context.go('/chat');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final isLoading = authState.isLoading;

    final footerColor = colorScheme.onSurface.withValues(alpha: 0.35);

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Spacer(),
                    // Logo
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Image.asset(
                          'assets/clude-logo-white.png',
                          width: 200,
                          height: 200,
                        ),
                        Text(
                          'AI that remembers you',
                          style: TextStyle(
                            fontSize: 14,
                            color: colorScheme.onSurface.withValues(alpha: 0.6),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 40),

                    // Email input
                    TextField(
                      controller: _emailController,
                      enabled: !isLoading,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.email],
                      decoration: InputDecoration(
                        hintText: 'your@email.com',
                        hintStyle: TextStyle(
                          color: colorScheme.onSurface.withValues(alpha: 0.35),
                        ),
                        prefixIcon: Icon(
                          Icons.mail_outline,
                          size: 20,
                          color: colorScheme.onSurface.withValues(alpha: 0.4),
                        ),
                        suffixIcon: ValueListenableBuilder<TextEditingValue>(
                          valueListenable: _emailController,
                          builder: (_, value, __) {
                            final hasText = value.text.isNotEmpty;
                            final isValid = _isValidEmail(value.text);
                            return Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (hasText)
                                  IconButton(
                                    icon: Icon(
                                      Icons.close,
                                      size: 18,
                                      color: colorScheme.onSurface
                                          .withValues(alpha: 0.5),
                                    ),
                                    onPressed: isLoading
                                        ? null
                                        : _emailController.clear,
                                    splashRadius: 18,
                                    tooltip: 'Clear',
                                  ),
                                TextButton(
                                  onPressed: (isLoading || !isValid)
                                      ? null
                                      : _submitEmail,
                                  style: TextButton.styleFrom(
                                    foregroundColor: isValid
                                        ? colorScheme.onSurface
                                        : colorScheme.onSurface
                                            .withValues(alpha: 0.4),
                                    disabledForegroundColor: colorScheme
                                        .onSurface
                                        .withValues(alpha: 0.4),
                                  ),
                                  child: const Text('Submit'),
                                ),
                              ],
                            );
                          },
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(
                            color: colorScheme.outline.withValues(alpha: 0.3),
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(
                            color: colorScheme.outline.withValues(alpha: 0.3),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(
                            color: colorScheme.outline.withValues(alpha: 0.6),
                          ),
                        ),
                      ),
                      onSubmitted: (_) => _submitEmail(),
                    ),
                    const SizedBox(height: 24),

                    // Continue with a wallet — hidden once email has text
                    if (_emailController.text.isEmpty)
                      const WalletConnectButton(),

                    // // "or" divider
                    // Row(
                    //   children: [
                    //     const Expanded(child: Divider()),
                    //     Padding(
                    //       padding: const EdgeInsets.symmetric(horizontal: 12),
                    //       child: Text(
                    //         'or',
                    //         style: TextStyle(
                    //           color:
                    //               colorScheme.onSurface.withValues(alpha: 0.4),
                    //           fontSize: 12,
                    //         ),
                    //       ),
                    //     ),
                    //     const Expanded(child: Divider()),
                    //   ],
                    // ),
                    // const SizedBox(height: 16),

                    // // API key toggle
                    // if (_showApiKey) ...[
                    //   ApiKeyInput(
                    //     controller: _apiKeyController,
                    //     errorText: authState.error,
                    //     enabled: !isLoading,
                    //   ),
                    //   const SizedBox(height: 12),
                    //   SizedBox(
                    //     height: 44,
                    //     child: ElevatedButton(
                    //       onPressed: isLoading ? null : _signInWithApiKey,
                    //       child: isLoading
                    //           ? const SizedBox(
                    //               height: 20,
                    //               width: 20,
                    //               child: CircularProgressIndicator(
                    //                   strokeWidth: 2),
                    //             )
                    //           : const Text('Sign in'),
                    //     ),
                    //   ),
                    // ] else
                    //   SizedBox(
                    //     height: 48,
                    //     child: OutlinedButton.icon(
                    //       onPressed: () =>
                    //           setState(() => _showApiKey = true),
                    //       style: OutlinedButton.styleFrom(
                    //         foregroundColor: colorScheme.onSurface,
                    //         side: BorderSide(
                    //           color: colorScheme.outlineVariant,
                    //         ),
                    //         shape: RoundedRectangleBorder(
                    //           borderRadius: BorderRadius.circular(10),
                    //         ),
                    //       ),
                    //       icon: Icon(Icons.key, size: 20, color: colorScheme.onSurface),
                    //       label: const Text('Sign in with API Key'),
                    //     ),
                    //   ),

                    // if (authState.error != null && !_showApiKey) ...[
                    //   const SizedBox(height: 8),
                    //   Text(
                    //     authState.error!,
                    //     style: TextStyle(
                    //       color: colorScheme.error,
                    //       fontSize: 13,
                    //     ),
                    //   ),
                    // ],
                    const Spacer(),

                    // Try for free — hidden once email has text
                    if (_emailController.text.isEmpty) ...[
                      SizedBox(
                        height: 48,
                        child: OutlinedButton(
                          onPressed: _continueAsGuest,
                          style: OutlinedButton.styleFrom(
                            foregroundColor: colorScheme.onSurface,
                            side: BorderSide(color: colorScheme.outlineVariant),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                          child: const Text('Try for free'),
                        ),
                      ),
                      const SizedBox(height: 24),
                    ],

                    // Footer
                    Text(
                      'Protected by Privy',
                      style: TextStyle(fontSize: 11, color: footerColor),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 6),
                    Text.rich(
                      TextSpan(
                        style: TextStyle(fontSize: 11, color: footerColor),
                        children: [
                          TextSpan(
                            text: 'Terms of Service',
                            recognizer: TapGestureRecognizer()
                              ..onTap = () => launchUrl(
                                Uri.parse('https://clude.io/terms'),
                                mode: LaunchMode.externalApplication,
                              ),
                          ),
                          const TextSpan(text: ' · '),
                          TextSpan(
                            text: 'Privacy Policy',
                            recognizer: TapGestureRecognizer()
                              ..onTap = () => launchUrl(
                                Uri.parse('https://clude.io/privacy'),
                                mode: LaunchMode.externalApplication,
                              ),
                          ),
                        ],
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet for OTP verification after email code is sent.
class _OtpVerifySheet extends ConsumerStatefulWidget {
  const _OtpVerifySheet({required this.ref, required this.email});

  final WidgetRef ref;
  final String email;

  @override
  ConsumerState<_OtpVerifySheet> createState() => _OtpVerifySheetState();
}

class _OtpVerifySheetState extends ConsumerState<_OtpVerifySheet> {
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;

    final success = await widget.ref
        .read(authNotifierProvider.notifier)
        .loginWithEmailCode(email: widget.email, code: code);

    if (mounted) {
      Navigator.of(context).pop(success);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = widget.ref.watch(authNotifierProvider);
    final isLoading = authState.isLoading;
    final error = authState.error;

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Enter your code',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            'We sent a code to ${widget.email}.',
            style: TextStyle(
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _codeController,
            enabled: !isLoading,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.oneTimeCode],
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'One-time code',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _verify(),
          ),
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error,
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontSize: 13,
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: isLoading ? null : _verify,
              child: isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Verify'),
            ),
          ),
        ],
      ),
    );
  }
}
