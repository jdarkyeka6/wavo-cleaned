# frozen_string_literal: true
# Read-only inventory of Apple Distribution certificates.
# Does not revoke, create, import or export a signing certificate.
require "base64"
require "spaceship"

def required_env(name)
  value = ENV[name].to_s.strip
  abort("Missing configured secret #{name}") if value.empty?
  value
end

key_text = required_env("ASC_KEY_CONTENT")
key_text = Base64.decode64(key_text) unless key_text.include?("BEGIN PRIVATE KEY")
abort("Invalid API key format") unless key_text.include?("BEGIN PRIVATE KEY")

token = Spaceship::ConnectAPI::Token.create(
  key_id: required_env("ASC_KEY_ID"),
  issuer_id: required_env("ASC_ISSUER_ID"),
  key: key_text,
  duration: 600
)
Spaceship::ConnectAPI.token = token

certs = Spaceship::ConnectAPI::Certificate.all.select do |cert|
  %w[DISTRIBUTION IOS_DISTRIBUTION].include?(cert.certificate_type.to_s)
end

puts "APPLE DISTRIBUTION CERTIFICATES: #{certs.length}"
certs.each_with_index do |cert, idx|
  label = (cert.respond_to?(:display_name) ? cert.display_name : nil).to_s
  label = (cert.respond_to?(:name) ? cert.name : nil).to_s if label.empty?
  expiry = cert.respond_to?(:expiration_date) ? cert.expiration_date.to_s : "unknown"
  puts "#{idx + 1}. certificate ID=#{cert.id} type=#{cert.certificate_type} name=#{label.inspect} expires=#{expiry}"
end

# Provisioning profiles can identify live dependencies. Fail conservatively
# when the API cannot provide a definitive certificate association.
begin
  profiles = Spaceship::ConnectAPI::Profile.all
  puts "PROVISIONING PROFILE COUNT: #{profiles.length}"
  profiles.each do |profile|
    name = profile.respond_to?(:name) ? profile.name.to_s : "unknown"
    kind = profile.respond_to?(:profile_type) ? profile.profile_type.to_s : "unknown"
    status = profile.respond_to?(:profile_state) ? profile.profile_state.to_s : "unknown"
    puts "Profile: #{name.inspect}; type=#{kind}; status=#{status}"
  end
rescue StandardError => e
  puts "Provisioning profile dependency inventory unavailable (#{e.class})."
end

puts "AUDIT COMPLETE: Read-only. Certificates are team-wide; profile names alone DO NOT prove any certificate is safe to revoke."
