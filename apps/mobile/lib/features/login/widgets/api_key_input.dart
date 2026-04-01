import 'package:flutter/material.dart';

class ApiKeyInput extends StatelessWidget {
  const ApiKeyInput({
    super.key,
    required this.controller,
    this.errorText,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String? errorText;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      obscureText: true,
      autocorrect: false,
      enableSuggestions: false,
      style: const TextStyle(fontFamily: 'monospace'),
      decoration: InputDecoration(
        hintText: 'clk_...',
        labelText: 'API Key',
        errorText: errorText,
        prefixIcon: const Icon(Icons.key),
      ),
    );
  }
}
